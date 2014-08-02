var Path = require('path');
var extend = require('extend');
var log = require('logthis').logger._create(Path.basename(__filename));
var util = require('util');
var moment = require('moment');

var VOW = require('dougs_vow');
var fs = require('fs-extra');

var htmlBuilder = require('html-builder').build;

var settings;

var index = {};
var indexList;
var teasers = {};
var frontPageRecipe;

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
    console.log('in getData');
    var data = '';
    req.on('data', function(chunk) {
        // console.log("received data!! And the chunk is:", chunk);
        data+=chunk;
    });
    
    req.on('error', function(e) {
        console.log('error on req!!!', e);
        vow['break']('Error on req ' + e.toString());
    });
    
    req.on('end', function() {
        // console.log('received all data');
        vow.keep(data);
    });
    return vow.promise;
}

function saveFile(req, options) {
    var vow = VOW.make();
    // console.log('in saveFile');
    try {
        var path = req.url.query && req.url.query.path;
        path = Path.join(options.basePath || '', path);
        console.log('PATH:', path);
        // fs.writeFile(process.cwd() + '/build/' + path, data, function(err) {
        fs.outputFile(path, req.data, function(err) {
            if(err) {
                console.log('ERROR!!!', err);
                vow['break']('Error trying to save file ' + err.toString());
            } else {
                console.log("The file was saved!");
                vow.keep();
            }
        }); 
        // res.write(JSON.stringify(data));
    } catch(e) {
        console.log('Failure to parse json');
        vow['break']('Probably failure to parse json' + e.toString());
            
    }
    return vow.promise;
} 

function save(req, res, options) {
    console.log("saveFile is handling post!!", options);
    
    var data;
    return req.session.get()
        .when(function(session){
            console.log('session data is: ' , session);
            if (options.auth && (!session.data || !session.data.verified))
                return VOW.broken('Not authorized.');
            return gatherData(req);
        })
        .when(
            function(someData) {
                req.data = someData;
                console.log('data received', req.data);
            })
        .when(
            function() {
                return saveFile(req, options);
            });
        // .when(
        //     function() {
        //         console.log('file saved');
        //         console.log('rebuilding site and sending response');
        //         // htmlBuilder.build();
        //         // return next(req, res, data);
        //     });
        // .when(
        //     function() {
        //         sendResponse(res);
        //     }, 
        //     function(err) {
        //         sendResponse(res, err);
        //     }
        // );
}; 

function remove(req, res) {
    
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
    log('dir:', dir);
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
    console.log(dir, fileName);
    var vow = VOW.make();
    // list[path] = extractMeta(data);
    console.log(dir);
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

function wrap(recipePath) {
    log(recipePath);
}

function archive() {
    //produce html that lists all posts grouped by year and month
    
}

function tags() {
    
    
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
    sortIndexListByDate();
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
    sortIndexListByDate();
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
            console.log('Error reading data file: '.red, e);
            return {};
        }
} 

function frontPage() {
    var recipe = frontPageRecipe ||
        evalFile(Path.join(settings.basePath, 'front-page-recipe.js'));
    sortIndexListByDate();
    recipe.partials.ids.main = pagedTeasers(indexList,3);
    recipe.partials.ids.tagWidget = tagPartial(3);
    recipe.partials.ids.archiveWidget = archivePartial();
    recipe.partials.ids.recentWidget = recentPartial(3);
    
    console.log(util.inspect(recipe, {colors:true, depth:10}));
    htmlBuilder(recipe).when(
        function() {
            console.log('ok!');
            reload();
        }
        ,function(err) {
            console.log('Error', err);
        }
    );
}

function tagPages() {
    var recipe = frontPageRecipe ||
        evalFile(Path.join(settings.basePath, 'tag-page-recipe.js'));
    var archive = groupByYearMonth();
    recipe.partials.ids.main = pagedTeasers(indexList,3);
    recipe.partials.ids.tagWidget = tagPartial(3);
    recipe.partials.ids.archiveWidget = archivePartial();
    recipe.partials.ids.recentWidget = recentPartial(3);
    
    console.log(util.inspect(recipe, {colors:true, depth:10}));
    htmlBuilder(recipe).when(
        function() {
            console.log('ok!');
            reload();
        }
        ,function(err) {
            console.log('Error', err);
        }
    );
}

var defaults = {
    basePath: 'build'
};

module.exports = {
    init: function (someSettings) {
        settings = extend(defaults, someSettings);
    },
    save: save //create, update
    ,delete: remove
    ,sendResponse: sendResponse
    ,writeIndexJson: writeIndexJson
    ,wrap: wrap
    ,archive: archive
    ,tags: tags
};
    



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
function test() {
    frontPage();
}

function reload() {
    console.log('sending reload');
    websocket.send('reload');
    websocket.close();
}

var WebSocket = require('ws');
var websocket;
var URL = "ws://localhost:9100";
function enableWebsocket() {
    console.log('Html-builder: Connecting to '.blue, URL);
    var probe;
    var tried = 0;
    function connect() {
        if (tried === 0) {
            console.log('Trying to connect to ' + URL);
        }
        else process.stdout.write('.');
        websocket = new WebSocket(URL);
    
        // When the connection is open, send some data to the server
        websocket.onopen = function () {
                
            websocket.send('buildMonitor connected');
            console.log('\nbuildMonitor connected to ' + URL);
            test();
            // clearTimeout(probe);
            tried = 0;
        };

        // Log errors
        websocket.onerror = function (error) {
            // console.log("ERROR", err);
        };

        // Log messages from the server
        websocket.onmessage = function (e) {
            clearTimeout(probe);
            console.log('Server: ' , e.data);
            // if (e.data === "reload") {
            //     location.reload();
            // }
        };
        
        websocket.onclose = function (e) {
            console.log("Connection closed..");
            // probe = setInterval(function() {
            //     connect();
            // },1000);
        };
        tried++;
    }
    connect();
    // probe = setInterval(function() {
    //     connect();
    // },1000);
};


enableWebsocket();
