var Path = require('path');
require('logthis').config({ _on: true, 'server.js': 'debug', 'bb-blog.js': 'debug' });
var log = require('logthis').logger._create(Path.basename(__filename));

var extend = require('extend');

var util = require('util');
var moment = require('moment');

var VOW = require('dougs_vow');
var fs = require('fs-extra');

var htmlBuilder = require('html-builder').build;
var serverConnection = require('./server-connection');

var settings;
var index = {};
var indexList;
var teasers = {};

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

function saveFile(req) {
    var vow = VOW.make();
    // console.log('in saveFile');
    try {
        var path = req.url.query && req.url.query.path;
        if (!settings.paths.some(function(p) {
            return path.indexOf(p) === 0;}))
            vow.breek();
        else {
            req.path = path = Path.join(settings.basePath || '', path);
            // fs.writeFile(process.cwd() + '/build/' + path, data, function(err) {
            fs.outputFile(path, req.data, function(err) {
                if(err) {
                    log._e('ERROR!!!', err);
                    vow['break']('Error trying to save file ' + err.toString());
                } else {
                    log("The file was saved!");
                    vow.keep();
                }
            }); 
        }
        // res.write(JSON.stringify(data));
    } catch(e) {
        log._e('Failure to parse json');
        vow['break']('Probably failure to parse json' + e.toString());
            
    }
    return vow.promise;
} 

function parseMetaData(txt) {
    //TODO parse text for following data:
    return { published: true,
             createdAt: new Date(),
             publishedAt: new Date(),
             tags: ["tag1", "tag2"],
             categories: ["catagory 1", "category 2"],
             comments: true
           };
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

var outPath;

function renderSite(req) {
    //make list of pages to render
    if (!index)
        index = createListing(Path.join(settings.basePath, settings.posts));
    indexList = Object.keys(index).map(function(k) { return index[k]; });
    sortIndexListByDate();
    //TODO
    //* is there a new file?, then do all three
    //update relevant tag and archive pages
    //* is a file updated? do the tagWidget potentially
    //redo tagpages and archive pages
    //* is a file removed?possibly do all three
    //redo relevant tag and archive pages
    
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
    createPage(config)
        .when(
            function() {
                log('--------------------');
                config = {
                    recipe: 'generic-recipe.js'
                    ,out: 'www/index.html' //optional, relative to root
                    ,indexList: indexList
                    ,widgets: widgets
                };
                return createPage(config);
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
                return createPage(config);
            })
        .when(
            function() {
                log('ok!');
                serverConnection.reload();
            }
            ,function(err) {
                log.e('Error', err);
            }
        );
    
    var toBeRendered = [];
    function recur() {
        if (toBeRendered.length) {
            return createPage(toBeRendered.pop()).when(
                recur
            );
        }
        else return VOW.kept();
    }
    return recur();
    //front page
    // createPage(config);
} 

var recipes = {};
function createPage(config) {
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

//API-----------------------
function save(req, res) {
    log("saveFile is handling post!!", settings);
    
    return req.session.get()
        .when(function(session){
            log('session data is: ' , session);
            if (settings.auth && (!session.data || !session.data.verified))
                return VOW.broken('Not authorized.');
            return gatherData(req);
        })
        .when(
            function(someData) {
                req.data = someData;
                log('data received', req.data);
                return saveFile(req);
            })
        .when(
            function() {
                log('Rendering site');
                return renderSite(req);
            })
        .when(
            function() {
                sendResponse(res);
            }, 
            function(err) {
                sendResponse(res, err);
            }
        );
}; 

function remove(req, res) {
    
}

var defaults = {
    basePath: 'build',
    auth: true,
    pagination: 3,
    paths: ['editable', 'posts'],
    posts: 'posts'
};

module.exports = {
    init: function (someSettings) {
        settings = extend(defaults, someSettings);
    },
    save: save, //create, update
    remove: remove
    // ,sendResponse: sendResponse
    // ,writeIndexJson: writeIndexJson
};
    

//TEST -=================================================

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

module.exports.init({
    basePath: '../../blog/build'
});

serverConnection.set(function () {
    renderSite();
});


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
