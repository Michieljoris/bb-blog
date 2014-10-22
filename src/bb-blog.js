var Path = require('path');
require('logthis').config({ _on: true, 'render.js': 'debug', 'bb-blog.js': 'debug' });
var log = require('logthis').logger._create(Path.basename(__filename));

require('datejs');
var extend = require('extend');
var util = require('util');
var VOW = require('dougs_vow');
var fs = require('fs-extra');
var sluggify = require('speakingurl');
var org = require("org");
var parser = new org.Parser();      

var htmlBuilder = require('html-builder');

var render = require('./render');

var settings;
var posts = {};
var publishedat;


//client should call location.pathname = pathname
function sendResponse(res, err, pathname) {
    var headers = {'Content-Type': 'text/html'};
    var returnCode = 403;
    var descr = err;
    if (!err) {
        // var expireDate = new Date(new Date().getTime() + 24*60*60).toUTCString();
        // headers['Set-Cookie'] = 'persona=' +obj.email + '; expires=' + expireDate;
        returnCode = 200;
        descr = "OK";
    }
    res.writeHead(returnCode, descr, headers);
    res.write(JSON.stringify({ success: !err, error: err, pathname: pathname}));
    res.end();
}

function gatherData(req) {
    var vow = VOW.make();
    var data = '';
    req.on('data', function(chunk) {
        // console.log("received data!! And the chunk is:", chunk);
        data+=chunk;
    });

    req.on('error', function(e) {
        log._e('error on req!!!', e);
        vow['break']('Error on req ' + e.toString());
    });

    req.on('end', function() {
        // console.log('received all data');
        vow.keep(data);
    });
    return vow.promise;
}

function saveFile(path, data) {
    log('Saving: ', path);
    var vow = VOW.make();
    path = Path.join(settings.paths.base || '', path);
    var callback = function(err) {
        if(err) {
            log._e('ERROR!!!', err);
            vow['break']('Error trying to save/remove file ' + err.toString());
        } else {
            log("The file was saved/removed!");
            vow.keep();
        }
    };
    if (typeof data !== 'undefined')
        fs.outputFile(path, data, callback);
    else fs.remove(path, callback);
    return vow.promise;
}

function parseValue(key, value) {
    if (typeof value === "undefined") return undefined;
    var booleans = {
        'yes': true, 'no': false, 'true': true, 'false': false, '0': false, '1': true };
    switch(key) {
      case 'tags':
      case 'categories':
        return value
            .replace(/,/g,' ')
            .split(' ')
            .filter(function(tag) {
                return tag.trim().length;  
            });
      case 'publishedat': return Date.parse(value);
      case 'delete' :
      case 'published' :
      case 'comments' : return booleans[value.toLowerCase()];
    default: return value;
    };
}

function getPreBlocks(str) {
    var idx = 0;
    function nextPreBlock() {
        //opening
        var check = str.indexOf('</pre>', idx);
        idx = str.indexOf('<pre>', idx);
        if (idx === -1) return -1;;
        if (check !== -1 && check < idx)
            log._e('Expecting opening <pre>, found closing </pre>, ignoring'.red);
        if (check === -1) log._e('Missing closing </pre>'.red);
        var start = idx;
            idx+=5;
        //closing
        check = str.indexOf('<pre>', idx);
        idx = str.indexOf('</pre>', idx);
        if (idx === -1) return -1;
        if (check !== -1 && check < idx)
            log._e('Expecting closing </pre>, found opening <pre>, ignoring'.red);
        idx +=5;
        var end = idx;
        return { start: start, end: end };
    }

    var result = [];
    if (typeof str === 'string') {
        var pre = nextPreBlock();
        while (pre !== -1) {
            result.push(pre);
            pre = nextPreBlock();
        }
    }
    return result;
}

//Takes a str and tries to retrieve metadata from the first <pre> block it finds
function parseMetaData(metaStr, defaults) {
    // var regexp = /<pre>([^]*)<\/pre>/;
    var meta = extend({ //published: false,
                        // title: postFileName.slice(0, postFileName.lastIndexOf('.')),
                        // created: new Date(),
                        // published: new Date(),
                        tags: [],
                        categories: []
                        // comments: false
                      }, defaults || {});
    // var metaText = regexp.exec(str);
    if (metaStr) {
        metaStr.split('\n')
            .filter(function(line) {
                return line.length; })
            .forEach(function(line) {
                var keyValue = line.split(':').map(function(part) {
                    return part.trim();
                });
                keyValue[0] = keyValue[0].toLowerCase();
                meta[keyValue[0]] = parseValue(keyValue[0], keyValue[1]);

            });
    }
    return meta;
}

function retrieveTeaser(str, preBlocks) {
    if (typeof str !== 'string') return '';
    var regexp = new RegExp('^\\s*---+\\s*$');
    var start, end;
    start = preBlocks[0] ? preBlocks[0].end + 1 : 0;
    // end = start + 10;
    //TODO just take a paragraph or two instead of the whole post...
    //but we need to parse the html for it and look for <p></p> blocks then..
    end = str.length;
    var sepBlock = preBlocks[1] ? preBlocks[1] : preBlocks[0];
    if (sepBlock) {
        var separator = str.slice(sepBlock.start + 5, sepBlock.end -5);
        var isSeperator = regexp.test(separator);
        if (isSeperator) end = sepBlock.start;
    }
    return str.slice(start, end);
}

//Parses raw post data and returns meta string and teaser string;
function parsePost(post, type) {
    if (type === '.html') {
        
    }
    else if (type === '.org') {
        var orgDocument = parser.parse(post);
        var orgHTMLDocument = orgDocument.convert(org.ConverterHTML, {
            headerOffset: 1,
            exportFromLineNumber: false,
            suppressSubScriptHandling: false,
            suppressAutoLink: false
        });
        post = orgHTMLDocument.contentHTML;
        
    }
    else throw new Error('Can not parse a post of type ' + type);
    
    var preBlocks = getPreBlocks(post);
    var metaBlock = preBlocks[0];
    return {
        metaStr: metaBlock ? post.slice(metaBlock.start + 5, metaBlock.end - 5) : '',
        teaser: retrieveTeaser(post, preBlocks) };
}

//parses a flat folder and returns an object of objects containing filename and
//metadata for each file, sets publish prop according to path
function createIndex(dir) {
    log('creating listing for dir:', dir);
    // var publish = Path.basename(dir) !== settings.unpublished;
    var files = fs.readdirSync(dir);
    var listing = {};
    files.forEach(function(file) {
        var fullPath =  Path.join(dir, file);
        var stat = fs.statSync(fullPath);
        if (!stat.isFile()) return;
        var post = fs.readFileSync(fullPath, { encoding: 'utf8' });
        post = parsePost(post, Path.extname(file));
        var title = file.slice(0, file.lastIndexOf('.'));
        listing[file] =
            // extend({ fileName: fullPath } ,
            parseMetaData(post.metaStr,
                          { createdAt: stat.ctime,
                            teaser: post.teaser,
                            title: title
                          });
        if (listing[file].published && !publishedat[file]) {
            listing[file].publishedat =
                publishedat[file] = listing[file].publishedat || new Date();
        }
        listing[file].file = file;
        listing[file].slug = sluggify(listing[file].title);
    });
    log('writing publishedat.json');
    fs.writeJsonSync(Path.join(settings.paths.base, settings.publishedat), publishedat);
    return listing;
}

function writeIndexJson(dir, fileName, data, outDir) {
    log(dir, fileName);
    var vow = VOW.make();
    log(dir);
    log('Saving json of dir contents to ' + Path.resolve(outDir, 'index.json'));
    try {
        if (!posts)  posts = createIndex(dir);
        else {
            posts[fileName] = extend({ fileName: Path.join(dir, fileName) },
                                     parseMetaData(data));
        }
        fs.outputJsonSync(Path.join(outDir, 'index.json'), posts);
        vow.keep();
    } catch(e) {
        vow.breek(e);
    }
    return vow.promise;
}


function processMeta(meta) {
    var old = posts[meta.file];
    log(meta);
    //delete
    // if (posts[meta.file] && meta.delete) {
    if (meta.delete) {
        fs.removeSync(Path.join(settings.paths.base, settings.paths.posts, meta.file));
        fs.removeSync(Path.join(settings.paths.www,
                                settings.pages.post.path, sluggify(meta.title) + '.html'));
        delete posts[meta.file];
        return null;
    }
    
    //clear out www/post if new post, deleted post or title has changed.
    //since we're now going to have to regenerate all of them with new widgets
    if (!old || meta.delete || old.title !== meta.title) {
        log('------------removing all posts in www/post');
        fs.removeSync(Path.join(settings.paths.www, settings.pages.post.path));
    }
        
    if (old && old.title !== meta.title) {
        fs.removeSync(Path.join(settings.paths.www, settings.pages.post.path,
                                old.slug +  '.html'));
    }
    // //publish
    if (meta.published && (!posts[meta.file] ||
                           (!posts[meta.file].published && !publishedat[meta.file])
                          ))
        publishedat[meta.file] = new Date();
    // title
    meta.title = meta.title || meta.file.slice(0, meta.file.lastIndexOf('.'));
    // meta.slug = sluggify(meta.title);
    meta.publishedat = meta.publishedat || publishedat[meta.file];
    meta.createdAt = posts[meta.file] ? posts[meta.file].createdAt : new Date();
    posts[meta.file] = meta;
}

function isUniqueSlug(slug) {
    try {
      fs.statSync(Path.join(settings.paths.www, settings.pages.post.path, slug + '.html'));
    } catch (e) { return true; };
    return false;
}


//1 new file
//2 updating file
//3 deleting file

function getUID(len){
    var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
          out = '';
    var n = Math.pow(chars.length, len);

    for(var i=0, clen=chars.length; i<len; i++){
       out += chars.substr(0|Math.random() * clen, 1);
    }
     return out;
}

function processPost(req, action) {
    var meta;
    var file = Path.basename(req.path);
    return (function postParser() {
        try { meta = parsePost(req.data, '.html');
              var title = file.slice(0, file.lastIndexOf('.'));
              meta = parseMetaData(meta.metaStr,
                                   { teaser: meta.teaser,
                                     title: title
                                   });
              meta.file = file;
              meta.slug = sluggify(meta.title);
              log('meta:', meta);
            
            } catch(e) { return VOW.broken(e); }
        if (typeof req.data === 'undefined')  {
            meta.delete = true;   
        }
        else if (!meta.delete) {
            log('data received', req.data, req.new);
            //make sure a new post has a unique 'file' name in build/post
            if (req.new && posts[meta.file]) {
                file = meta.file = meta.file.slice(0, meta.file.lastIndexOf('.')) +
                    '_' + getUID(6) + Path.extname(meta.file);
                req.path = Path.join(settings.paths.posts, meta.file);
                meta._all = true;
            }
            //make sure any new posts or retitled posts are have unique titles:
            if (
                (req.new || (posts[file] && posts[file].title !== meta.title)) &&
                    !isUniqueSlug(meta.slug)
            ) return VOW.broken({
                msg: 'The title does not generate a unique url for the post'});
            else return saveFile(req.path, req.data); 
        }
        return VOW.kept();
    }()).when(
        function() {
            log('Rendering site after saving/removing post: ', req.path);
            try {
                // var old = posts[meta.file];
                file = processMeta(meta);
            } catch (e) { return VOW.broken(e); }
            return render.renderSite(posts, file);
        })
        .when(
            function() {
                //return path for the client to load when receiving response
                if (action === 'new')
                    return Path.join(settings.pages.unpublished.path, meta.slug);
                if (action === 'save') return Path.join(
                    !meta.published ?
                        settings.pages.unpublished.path :
                        settings.pages.post.path,
                    meta.slug);
                // if (action === 'delete') return settings.paths.blog;
                return settings.paths.blog ? settings.paths.blog : false;
            }
        );
                    
}

//API-----------------------
function handleRequest(req, res, action) {
    log("handleRequest is handling post!!", settings, action);

    return req.session.get()
        .when(function(session){
            log('session data is: ' , session);
            if (settings.auth && (!session.data || !session.data.verified))
                return VOW.broken('Not authorized.');
            if (action === 'save' || action === 'new') return gatherData(req);
            else return VOW.kept();
        })
        .when(
            function(someData) {
                req.path = req.url.query && req.url.query.path;
                if (!req.path && ! req.someData)
                    return render.renderSite(posts);
                req.data = someData;
                // log('-------------------------', someData);
                //only save/remove at valid 'paths'
                var isValidPath = settings.writable.some(function(p) {
                    // var valid = req.path.indexOf(p + '/') === 0;
                    // if (valid) req.key = req.path.slice(p.length+1);
                    return req.path.indexOf(p + '/') === 0;
                    // return valid;
                });
                //process post if path matches
                if (action === 'new') req.new = true;
                return isValidPath ?
                    (req.path.indexOf(settings.paths.posts) === 0 ?
                     processPost(req, action) : saveFile(req.path, req.data)) :
                VOW.broken('Not a valid path: ' + req.path);
            })
        .when(
            function(pathname) {
                log('file saved');
                if (req.path.indexOf(settings.paths.posts) !== 0) {
                    log('rebuilding site and sending response');
                    return htmlBuilder.build();
                }
              else return VOW.kept(pathname);     
            })
        .when(
            function(pathname) {
                log('sending response, all good, pathname:', pathname);
                sendResponse(res, null, pathname);
            },
            function(err) {
                log('sending response, ERROR!', err);
                sendResponse(res, err);
            }
        );
};

//Any of these settings can be overridden by calling the init function on this
//module and passing different values. Any values not defined are taken from
//this set of defaults
var defaults = {
    //used as meta title for any blog page
    siteTitle: 'Blog',
    paths: {
        //Base path to directory with source files for html-builder:
        base: 'build',
        //Path where posts are saved, relative to paths.base:
        posts: 'post',
        //Path to directory served to internet:
        www: 'www',
        //Path where widgets are found, relative to www
        widgets: 'widget'
    },
    //Bb-blog saves data to the server, this limits
    //which paths it is allowed to save to. This is relative to the paths.base
    //path.
    writable: ['editable', 'post']
    //Whether to check for session.data.verified === true, set to false for
    //testing purpose
    ,auth: true,
    //Number of teasers/posts per page on collection pages such as landing,
    //archive and tag.
    pagination: 3
    //Recent, archive and tag widget
    //You would set save to true if you want to pull these widgets in ajax calls
    //to build a page dynamically on the client, they get saved to path set in
    //paths above, max refers to number blog titles listed in a widget
    ,widgets: {
        recent: { max: 3, save: false } ,archive: { save: false } ,tag: { max: 3 }
    }
    //If set to true, whether comments are enabled are decided per post,
    //depending on what the setting is in the post's metadata. 
    ,enableCommentsPerPost: true
    //Global comment setting, only effective if previous setting is set to
    //false, set both to false to disable comments alltogether
    ,comments: true
    
    //A recipe (string) or a list of recipes used to build pages unless
    //overridden for a page in the particular pages prop below.
    ,recipe: { editable: 'recipe.js', nojs: 'recipe.js' }
    //If the previous prop is a list the following prop decides which recipe in
    //the list is used. This should be one of the keys of the previous prop.
    ,renderMode: 'editable'
    //Default path into a recipe to where bb-blog is to insert its payload
    //(post, archive/tag/landing teaser list etc), can also be overridden for
    //any particular page by adding this setting to it, eg to pages.post.from
    ,from: [ 'fromTemplate', 'mapping', 'main']
    //Default object path into a recipe to where bb-blog is to insert the out
    //path for a particular page, for instance pages.post.path gets inserted
    //here when building a post page. Can be set per page as well.
    ,to: [ 'toTemplate', 'out' ]
    //For keeping track of when first published. Can be overridden by adding
    //publishedat metadata to a post, no need to modify. TODO Maybe should be
    //removed from here..
    ,publishedat: 'publishedat.json'
    
    //Bb-blog can build collections of posts, organised by tag, year/month,
    //unpublished status and just all of them in reverse chronological order
    //(landing). Other than that it can build a page for every post as well. Set
    //any of the following to false to prevent the page(s) from being build. Or
    //assign an object specifying path to save the pages to (relative to
    //base.www) and/or a recipe to use to build the page. A full example set of
    //props is given for the archive page. All pages can also just be set to
    //true or false, or a string for a path.
    ,pages: {
        // Landing page with all teasers of posts (paginated).
        landing: true,
        // Archive pages. Teasers of posts listed by years and months. 
        archive: { path: 'archive'
                   // ,recipe: 'some archive recipe'  //or:
                   // ,recipe: { editable: 'recipe.js', nojs: 'recipe.js' }
                   // ,from: [ 'fromTemplate', 'mapping', 'main']
                   // ,to: [ 'toTemplate', 'out' ]
                 },
        // List of teasers of posts, listed by tag. 
        tag: { path: 'tag' },
        // A page with a post
        post: { path: 'post' },
        //Any unpublished posts will be added to the unpublished folder, not to
        //the post folder. Only prop that can be set is the path.
        unpublished: { path: 'unpublished' }
    }
    //NOT TESTED
    //Json of list of posts on server. Also set whether to add precalculated
    //lists. Set to false to disable producing this json. Can be used by client
    //to dynamically build a blog.
    ,json: { byTag: true, byYearMonth: true, byReverseDate: true }
};

function myExtend(a, b) {
    var obj = {};
    Object.keys(a).forEach(function(key) {
        obj[key] = a[key];
    });
    Object.keys(b).forEach(function(key) {
        if (typeof a[key] === 'object' && !util.isArray(b[key]) && 
            typeof b[key] === 'object' && !util.isArray(b[key])) {
            obj[key] = myExtend(a[key], b[key]);
        }
        else obj[key] = b[key];
    });
    return obj;
    
}

module.exports = {
    init: function init(someSettings) {
        // settings = myExtend(defaults, someSettings, true);
        
        settings = extend(true, defaults, someSettings);
        // log(util.inspect(settings, { depth:10, colors:true }));
        // log('someSettings', util.inspect(someSettings, { depth:10, colors:true }));
        try {
            publishedat = fs.readJsonSync(Path.join(settings.paths.base, settings.publishedat));
        } catch (e) { publishedat = {}; }
        fs.ensureDirSync(Path.join(settings.paths.base, settings.paths.posts));
        posts = createIndex(Path.join(settings.paths.base, settings.paths.posts));
        log('List of posts meta:\n', util.inspect(posts, { depth:10, colors:true }));
        render.init(settings);
        render.renderSite(posts);
    },
    save: function(req, res) { handleRequest(req, res, 'save'); },
    new: function(req, res) { handleRequest(req, res, 'new'); },
    remove: function(req, res) { handleRequest(req, res, 'remove'); },
    render: function(req, res) { handleRequest(req, res); }
    // ,sendResponse: sendResponse

    // ,writeIndexJson: writeIndexJson
};

