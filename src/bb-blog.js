var Path = require('path');
require('logthis').config({ _on: true, 'server.js': 'debug', 'bb-blog.js': 'debug' });
var log = require('logthis').logger._create(Path.basename(__filename));

require('datejs');
var extend = require('extend');
var util = require('util');
var moment = require('moment');
var VOW = require('dougs_vow');
var fs = require('fs-extra');

var htmlBuilder = require('html-builder').build;
var webSocketConnection = require('./server-connection');

var settings;
var index = {};
var indexList;
var teasers = {};

var recipes = {};
var outPath;


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

function addRemoveFile(req) {
    log('in addremovefile');
    var vow = VOW.make();
    var path = req.url.query && req.url.query.path;
    //only save/remove at valid 'paths'
    if (!settings.paths.some(function(p) {
        return path.indexOf(p) === 0;}))
        vow.breek('Not a valid path: ' + path);
    else {
        log('adding/removing: ', path);
        req.path = path = Path.join(settings.basePath || '', path);
        var callback = function(err) {
            if(err) {
                log._e('ERROR!!!', err);
                vow['break']('Error trying to save/remove file ' + err.toString());
            } else {
                log("The file was " + ( req.data ? 'saved!' : 'removed!'));
                vow.keep();
            }
        };
        if (typeof req.data !== 'undefined')
            fs.writeFile.apply(fs, [path, req.data, callback]);
        else fs.remove.apply(fs, [path, callback]);
    }
    return vow.promise;
} 

function parseValue(key, value) {
    log(key, value);
    var booleans = {
        'yes': true, 'no': false, 'true': true, 'false': false, '0': false, '1': true };
    switch(key) {
        case 'tags':
        case 'categories': return value.replace(/,/g,' ').split(' ');
        case 'published':
        // case 'created': return moment(value).format('D/MMM/YYYY');
        case 'created': return Date.parse(value);
        default: return typeof booleans[value] === 'boolean' ? booleans[value] : value;
    };
}

function parseMetaData(postFileName, text) {
    var regexp = /<pre>([^]*)<\/pre>/;
    var meta = { published: false,
                 title: postFileName.slice(0, postFileName.lastIndexOf('.')),
                 created: new Date(),
                 published: new Date(),
                 tags: [],
                 categories: [],
                 comments: false
               };
    var metaText = regexp.exec(text);
    if (metaText) {
        metaText = metaText[1];
        metaText.split('\n')
            .filter(function(line) {
                return line.length; })
            .forEach(function(line) {
                    var keyValue = line.split(':').map(function(part) {
                        return part.trim(); 
                    });
                meta[keyValue[0]] = parseValue(keyValue[0], keyValue[1]);
            
            });
    }
    log(meta);
    // log(meta.title, metaText);
    
    //TODO parse text for following data:
}

//this is a flat folder for now
function createListing(dir) {
    log('creating listing for dir:', dir);
    var files = fs.readdirSync(dir); 
    var listing = {};
    files.forEach(function(file) {
        var obj = {};
        obj.fileName =  Path.join(dir, file);
        var stat = fs.statSync(obj.fileName);
        if (stat.isFile()) {
            var data = fs.readFileSync(obj.fileName, { encoding: 'utf8' });
            listing[file] = extend(obj, parseMetaData(data));
        }
    });
    return listing;
}

function writeIndexJson(dir, fileName, data, outDir) {
    log(dir, fileName);
    var vow = VOW.make();
    // list[path] = extractMeta(data);
    log(dir);
    log('Saving json of dir contents to ' + Path.resolve(outDir, 'index.json'));
    try {
        if (!index)  index = createListing(dir);
        else {
            index[fileName] = extend({
                fileName: Path.join(dir, fileName) },parseMetaData(data));
        }
        fs.outputJsonSync(Path.join(outDir, 'index.json'), index);
        vow.keep();
    } catch(e) {
        vow.breek(e);
    }
    return vow.promise;
}

function sortIndexListByDate() {
    indexList.sort(function compare(p1, p2) {
        var a = p1.publishedAt;
        var b = p2.publishedAt;
        if (a > b)
            return -1;
        if (a < b)
            return 1;
        // a must be equal to b
        return 0;
    });
}

function recentPartial(n, filterAttr) {
    return '<ul id="most-recent-partial">\n' +
        indexList
        .filter(function(p) {
            return !filterAttr || p[filterAttr];
        })
        .slice(0,n).map(function(p) {
            return '  <li>' + '<a href="' + p.slug + '">' + p.title + '</a></li>';
        }).join('\n') +
        '\n</ul>';
}

function groupByTag(filterAttr) {
    var tags = {};
    indexList
        .filter(function(p) {
            return !filterAttr || p[filterAttr];
        })
        .forEach(function(p) {
            p.tags = p.tags || [];
            p.tags.forEach(function(t) {
                tags[t] = tags[t] || [];
                tags[t].push(p);
            });
        });
    return tags;
}

function tagPartial(n) {
    var tags = groupByTag();
    if (!n) n = Object.keys(tags).length;
    return '<ul id="by-tag-partial">\n' +
        Object.keys(tags)
        .sort(function(t1, t2) {
            var a = tags[t1].length;
            var b = tags[t2].length;
            if (a > b) return -1;
            if (a < b) return 1;
            return 0;
        })
        .slice(0,n)
        .map(function(t) {
            return '  <li>' + '<a href="' + t + '">' + t + '</a> (' + tags[t].length + ')</li>';
        }).join('\n') +
        '\n</ul>';
}

function groupByYearMonth(filterAttr) {
    var archive = {};
    indexList
        .filter(function(p) {
            return !filterAttr || p[filterAttr];
        })
        .forEach(function(p) {
        if (p.publishedAt) {
            var m = moment(p.publishedAt);
            var year = m.year();
            var month = m.month();
            archive[year] = archive[year] || {};
            archive[year][month] = archive[year][month] || [];
            archive[year][month].unshift(p);
        }
    });
    return archive;
}
var month = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul',
              'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

function url(link, text) {
    return '<a href="' + link + '" >'  + (text || link) + '</a>';
}

function archivePartial() {
    var archive = groupByYearMonth();
    return '<ul id="archive-partial">\n' +
        Object.keys(archive).map(function(y) {
            return ' <li>' + url(y) + '\n' + '  <ul>\n' + 
                Object.keys(archive[y]).map(function(m) {
                    return '   <li>' + url(y + '/' + m, month[m]) + '\n' + '    <ul>\n' + 
                        archive[y][m].map(function(p) {
                            return '     <li>' + url(p.slug, p.title) + '</li>';
                        }).join('\n') +
                        '\n    </ul>\n   </li>';
                }).join('\n') +
                '\n  </ul>\n </li>';
        }).join('\n') +
        '\n</ul>';
}

function teaser(data) {
    var regexp = new RegExp('^(.*)<p><b> *teaser *</b></p>(.*)$');
    var result = regexp.exec(data);
    return result ? result[2] : data;
}

function postIterator(posts, n) {
    return function() {
        var slice = posts.slice(0,n);
        posts = posts.slice(n);
        return slice;
    };
} 

function pagedTeasers(posts, n) {
    var pageGetter = postIterator(posts, n);
    var pagedPosts = [];
    var page = pageGetter();
    while (page.length) {
        pagedPosts.push(page);
        page = pageGetter();
    }
    var pagedTeasers = [];
    pagedPosts.forEach(function(posts) {
        var page = posts.map(function(post) {
           return '<div class="teaser">' + teasers[post.title] + '</div>' +
                '<div class="more"><a href="' + post.slug + '">More</a></div>';
        }).join('\n');
        pagedTeasers.push(page);
    });
    return pagedTeasers;
}

function evalFile(fileName) {
    var file;
    try { file = fs.readFileSync(fileName, 'utf8');
          eval(file);
          return exports;
        } catch (e) {
            log._e('Error reading data file: '.red, e);
            return {};
        }
} 

function renderPage(config) {
    outPath =  config.out;
    var recipe = recipes[config.recipe] = recipes[config.recipe] ||
        evalFile(Path.join(settings.basePath, config.recipe));
    //Set ids:
    Object.keys(recipe.partials.ids).forEach(function(id) {
        if (!recipe.partials.ids[id])
            recipe.partials.ids[id] = config.widgets[id];
    });
    
    log(util.inspect(recipe, {colors:true, depth:10}));
    return htmlBuilder(recipe);
}

function renderSite(path, text) {
    //all info is in req.path and req.data;
    //if both are falsey render whole site,
    //if typeof req.data is undefined a post has been removed
    //otherwise the data has been saved to path
    var postFileName = Path.basename(path);
    parseMetaData(postFileName, text);
    return VOW.kept();
    
    //make list of pages to render
    if (!index)
        index = createListing(Path.join(settings.basePath, settings.posts));
    indexList = Object.keys(index).map(function(k) { return index[k]; });
    sortIndexListByDate();
    var widgets = {
        tagWidget: tagPartial(3)
        ,archiveWidget: archivePartial()
        ,recentWidget: recentPartial(3)
        // ,main: pagedTeasers(indexList, 3)
    };
    var config;
    //front page
    config = {
        recipe: 'generic-recipe.js'
        ,out: 'www/index.html' //optional, relative to root
        ,indexList: indexList
        ,widgets: widgets
    };
    renderPage(config)
        .when(
            function() {
                log('--------------------');
                config = {
                    recipe: 'generic-recipe.js'
                    ,out: 'www/index.html' //optional, relative to root
                    ,indexList: indexList
                    ,widgets: widgets
                };
                return renderPage(config);
            })
        .when(
            function() {
                log('--------------------');
                config = {
                    recipe: 'generic-recipe.js'
                    ,out: 'www/tag.html' //optional, relative to root
                    ,indexList: indexList
                    ,widgets: widgets
                };
                return renderPage(config);
            })
        .when(
            function() {
                log('ok!');
                // reload();
            }
            ,function(err) {
                log.e('Error', err);
            }
        );
    
    var toBeRendered = [];
    function recur() {
        if (toBeRendered.length) {
            return renderPage(toBeRendered.pop()).when(
                recur
            );
        }
        else return VOW.kept();
    }
    return recur();
    //front page
    // createPage(config);
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
                req.data = someData;
                log('data received', req.data);
                return addRemoveFile(req);
            })
        .when(
            function() {
                log('Rendering site after saving/removing post: ', req.path);
                return renderSite(req.path, req.data);
                return VOW.kept();
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
    basePath: 'build',
    //valid paths to save files, relative to basePath
    paths: ['editable', 'post'],
    //path where posts are found
    posts: 'post',
    //path where teasers are found
    teasers: 'teaser',
    //path where unpublished posts/teasers are found
    //this is relative to the posts/teasers path
    unpublished: 'unpublished',
    //when true save only when session.data.verified == true
    auth: true,
    //Number of teasers/posts per page
    pagination: 3
    //what to build:
    // ** widgets
    // recent, archive and tag widget
    ,widgets: {
        recent: { save: false } ,archive: { save: false } ,tag: false
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
        // next/previous month/year 
        // previous, next, page number, last, first page  
        // ,year: 'some year recipe.js'
        ,year: true
        // *** a landing page with all posts (paginated)
        ,list: true
        // *** always a post page 
    }
    //recipe used by pages unless specified otherwise
    ,recipe: 'recipe.js'
    // ** json of posts on server by post ide
    //Also set whether to add precalculated lists
    ,json: { byTag: true, byYearMonth: true, byReverseDate: true }
    
};

module.exports = {
    init: function (someSettings) {
        settings = extend(defaults, someSettings);
    },
    save: function(req, res) { handleRequest(req, res, 'save'); },
    remove: function(req, res) { handleRequest(req, res, 'remove'); },
    render: renderSite
    // ,sendResponse: sendResponse
    
    // ,writeIndexJson: writeIndexJson
};
    

//TEST -=================================================
module.exports.init({
    //build dir of blog repo
    basePath: '../../blog/build',
    auth: false
});

console.log(settings);


var synergipsum = require('synergipsum');
function lorem(maxParagraphs) {
    if (maxParagraphs <= 0) return '';
    var min = 3, max  = 6;
    var result = [];
    while (maxParagraphs--) {
        var paragraphLength = min + Math.floor(Math.random()*(max+1-min));
        var generator = synergipsum.create(paragraphLength); 
        result.push('<p>' + generator.generate() + '</p>');
    }
    return result.join('\n');
}

// console.log(lorem(3));

indexList = [
    { title: 'Some title', publishedAt: new Date('11/May/2010')  ,tags: ["a", "b", "d"]},
    { title: 'What is this about', publishedAt: new Date('20/Oct/2010') ,tags: ["c", "b", "d"]},
    { title: 'A very important post', publishedAt: new Date('12/Oct/2010')  ,tags: ["d", "a"]},
    { title: 'Oh, I do blabber on', publishedAt: new Date('12/Jan/2011')  ,tags: ["d", "a"]},
    { title: 'Now what?', publishedAt: new Date('12/Feb/2012')  ,tags: ["d", "a"]}
];



// var teaserList = [
//     { title: 'abc', publishedAt: new Date('11/May/2010')  ,tags: ["a", "b", "d"]},
//     { title: 'def', publishedAt: new Date('20/Oct/2010') ,tags: ["c", "b", "d"]},
//     { title: 'ghi', publishedAt: new Date('12/Oct/2010')  ,tags: ["d", "a"]},
//     { title: 'ghi2', publishedAt: new Date('12/Jan/2011')  ,tags: ["d", "a"]},
//     { title: 'ghir', publishedAt: new Date('12/Feb/2012')  ,tags: ["d", "a"]}
// ];
indexList.forEach(function(t) {
    teasers[t.title] = t.tags.join('-');
    t.slug = t.title.toLowerCase().replace(/ /g, '-').replace(/[^A-Za-z0-9_-]/g, '');
});


// This little module opens a connection to URL, when opened executes fun and
// returns a function that can send the reload msg to the open websocket at URL.
// var URL = "ws://localhost:9100";
// var reload = webSocketConnection.onOpen(URL, function () {
//     var path = Path.join( 'post', "testsave");
//     addRemoveFile({ url: { query: { path: path }}, data: null});
//     // fs.outputFile(Path.join(settings.basePath, 'post', "testsave"), "some test dataa", function(err) {
//     //     if(err) {
//     //         log._e('ERROR!!!', err);
//     //         // vow['break']('Error trying to save file ' + err.toString());
//     //     } else {
//     //         log("The file was saved!");
//     //         // vow.keep();
//     //     }
//     // }); 
    
//     // renderSite();
// });


// var lorem = require('lorem');
// var paragraphAsAString = lorem.ipsum('p');
// console.log(paragraphAsAString);

// var S = require('synergipsum');
// var s0 = S.create(20); // a synergipsum w/ 2 paragraphs
// var bla = s0.generate();
// console.log(bla);


// console.log(teasers);

// console.log(recentPartial(5));

// var res = groupByTag();
// console.log(util.inspect(res, {colors:true, depth:10}));
// res = tagPartial(2);
// console.log(res);
// var s = 'basdf asf asdf asfd -- dasfasdf <p><b>     teaser </b></p> -asdfasdf ---';
// var res = groupByYearMonth();
// console.log(util.inspect(res, {colors:true, depth:10}));

// console.log(archivePartial());


// console.log(teaser(s));
                 


// console.log(pagedTeasers(indexList, 2));
