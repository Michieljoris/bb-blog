var Path = require('path');
require('logthis').config({ _on: true, 'render.js': 'debug', 'bb-blog.js': 'debug' });
var log = require('logthis').logger._create(Path.basename(__filename));

require('datejs');
var extend = require('extend');
var util = require('util');
var VOW = require('dougs_vow');
var fs = require('fs-extra');
var sluggify = require('speakingurl');

var render = require('./render');

var settings;
var index = {};
var publishedat;



function sendResponse(res, err) {
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
    res.write(JSON.stringify({ success: !err, error: err}));
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
      case 'categories': return value.replace(/,/g,' ').split(' ');
      case 'publishedat': return Date.parse(value);
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
function parsePost(post) {
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
        post = parsePost(post);
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
        if (!index)  index = createIndex(dir);
        else {
            index[fileName] = extend({ fileName: Path.join(dir, fileName) },
                                     parseMetaData(data));
        }
        fs.outputJsonSync(Path.join(outDir, 'index.json'), index);
        vow.keep();
    } catch(e) {
        vow.breek(e);
    }
    return vow.promise;
}

function processMeta(meta) {
    log(meta);
    
    //delete
    if (index[meta.file] && meta.delete) {
        fs.removeSync(Path.join(settings.paths.base, settings.paths.posts, meta.file));
        delete index[meta.file];
        return;
    }
    // //publish
    if (meta.published && (!index[meta.file] ||
                           (!index[meta.file].published && !publishedat[meta.file])
                          ))
        publishedat[meta.file] = new Date();
    // title
    meta.title = meta.title || meta.file.slice(0, meta.file.lastIndexOf('.'));
    // meta.slug = sluggify(meta.title);
    meta.publishedat = meta.publishedat || publishedat[meta.file];
    meta.createdAt = index[meta.file] ? index[meta.file].createdAt : new Date();
}

//1 new file
//2 updating file
//3 deleting file

function processPost(req) {
    var meta;
    var file = Path.basename(req.path);
    return (function() {
        try { meta = parsePost(req.data);
              var title = file.slice(0, file.lastIndexOf('.'));
              meta = parseMetaData(meta.metaStr,
                                   { teaser: meta.teaser,
                                     title: title
                                   });
              meta.file = file;
              meta.slug = sluggify(meta.title);
            
            } catch(e) { return VOW.broken(e); }
        if (typeof req.data === 'undefined')  {
            meta.delete = true;   
        }
        else if (!meta.delete) {
            log('data received', req.data);
            return saveFile(req.path, req.data); 
        }
        return VOW.kept();
    }()).when(
            function() {
                log('Rendering site after saving/removing post: ', req.path);
                try {  processMeta(meta);
                       var old = index[meta.file];
                       index[meta.file] = meta;
                    } catch (e) { return VOW.broken(e); }
                return render.renderSite(index, old, file);
            });
                    
}

//API-----------------------
function handleRequest(req, res, action) {
    log("handleRequest is handling post!!", settings);

    return req.session.get()
        .when(function(session){
            log('session data is: ' , session);
            if (settings.auth && (!session.data || !session.data.verified))
                return VOW.broken('Not authorized.');
            if (action === 'save') return gatherData(req);
            else return VOW.kept();
        })
        .when(
            function(someData) {
                req.path = req.url.query && req.url.query.path;
                if (!req.path && ! req.someData)
                    return render.renderSite(index);
                req.data = someData;
                //only save/remove at valid 'paths'
                var isValidPath = settings.writable.some(function(p) {
                    // var valid = req.path.indexOf(p + '/') === 0;
                    // if (valid) req.key = req.path.slice(p.length+1);
                    return req.path.indexOf(p + '/') === 0;
                    // return valid;
                });
                //process post if path matches
                return isValidPath ?
                    (req.path.indexOf(settings.paths.posts) === 0 ? processPost(req) :
                     saveFile(req.path, req.data)) :
                VOW.broken('Not a valid path: ' + req.path);
                    
            })
        .when(
            function() {
                log('sending response, all good');
                sendResponse(res);
            },
            function(err) {
                log('sending response, ERROR!');
                sendResponse(res, err);
            }
        );
};

var defaults = {
    paths: {
        //paths.base to directory with source files for html-builder
        base: 'build',
        //path where posts are found, relative to paths.base
        posts: 'post',
        //path to directory served to internet
        www: 'www',
        //path where teasers are found, relative to www
        teasers: 'teaser',
        //path where posts are found, relative to www
        wwwPosts: 'post',
        //path where widgets are found, relative to www
        widgets: 'widget'
    }
    ,writable: ['editable', 'post']
    //whether to check for session.data.verified === true
    ,auth: true,
    //Number of teasers/posts per page
    pagination: 3
    // recent, archive and tag widget
    ,widgets: {
        recent: { max: 3, save: false } ,archive: { save: false } ,tag: { max: 3 }
    }
    ,pages: {
        // *** an list page, just a list in tree form, by year/month
        // archive: { recipe: 'some archive recipe' }
        archive: true
        // *** a tag page, paginated, teasers
        // links to other pages when more than one page
        // previous, next, page number, last, first page
        ,tag: true
        // *** a month page, paginated, teasers
        // next/previous month/year
        // links to other pages when more than one page
        ,month: true //uses default recipe
        // previous, next, page number, last, first page
        // *** a year page, paginated, teasers
        // links to other pages when more than one page
        // next/previous monthngs/year
        // previous, next, page number, last, first page
        // ,year: 'some year recipe.js'
        ,year: true
        // *** a landing page with all posts (paginated)
        ,landing: true
        // *** a page with the post
        ,post: true
    }
    //recipe used by pages unless specified otherwise
    ,recipe: 'recipe.js'
    // ** json of posts on server by post ide
    //Also set whether to add precalculated lists
    ,json: { byTag: true, byYearMonth: true, byReverseDate: true }
    //for keeping track of when first published
    //can be overridden by adding publishedat metadata
    ,publishedat: 'publishedat.json'

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
        log(util.inspect(settings, { depth:10, colors:true }));
        try {
            publishedat = fs.readJsonSync(Path.join(settings.paths.base, settings.publishedat));
        } catch (e) { publishedat = {}; }
        index = createIndex(Path.join(settings.paths.base, settings.paths.posts));
        log(util.inspect(index, { depth:10, colors:true }));
        render.init(settings);
    },
    save: function(req, res) { handleRequest(req, res, 'save'); },
    remove: function(req, res) { handleRequest(req, res, 'remove'); },
    render: function(req, res) { handleRequest(req, res); }
    // ,sendResponse: sendResponse

    // ,writeIndexJson: writeIndexJson
};



// module.exports.init({
//     paths: { base: 'build' , posts: 'post', www: 'blabla' },
//     writable: ['editable', 'post'],
//     pagination: 3,
//     auth: false
// });
