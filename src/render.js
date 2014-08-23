var Path = require('path');
var log = require('logthis').logger._create(Path.basename(__filename));
  
var VOW = require('dougs_vow');
var moment = require('moment');
var fs = require('fs-extra');
var util = require('util');
var htmlBuilder = require('html-builder').build;

var webSocketConnection = require('./server-connection');

var settings;
var postList;
var recipes = {};

var widgets;
  
function groupByTag(filterAttr) {
    var tags = {};
    postList
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

function groupByYearMonth(filterAttr) {
    var archive = {};
    postList
        .filter(function(p) {
            return !filterAttr || p[filterAttr];
        })
        .forEach(function(p) {
            if (p.publishedat) {
                var m = moment(p.publishedat);
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
  

function sortIndexListByDate() {
    postList.sort(function compare(p1, p2) {
        var a = p1.publishedat;
        var b = p2.publishedat;
        if (a > b)
            return -1;
        if (a < b)
            return 1;
        // a must be equal to b
        return 0;
    });
}

function recentPartial(options, filterAttr) {
    if (!options) return null;
    var n = options.max;
    var partial = '<ul id="most-recent-partial">\n' +
        postList
        .filter(function(p) {
            return !filterAttr || p[filterAttr];
        })
        .slice(0,n).map(function(p) {
            var path = Path.join(settings.wwwPosts || 'post', p.slug);
            return '  <li>' + '<a href="' + path + '">' + p.title + '</a></li>';
        }).join('\n') +
        '\n</ul>';
    
    if (options.save) {
        fs.outputFileSync(Path.join(settings.paths.www,
                               settings.paths.widgets, 'recent.html'), partial);
    }
    return partial;
}

function url(link, text) {
    
    return '<a  href="/' + link + '" >'  + (text || link) + '</a>';
}

// function folder(name) {
//    return '<label for="'+ name +'">' + name + '</label> <input type="checkbox"  id="'+
//         name +'" /> ';
//    // return '<label for="folder1">Folder 1</label> <input type="checkbox" checked disabled id="folder1" /> ';
// }

function archivePartial(options) {
    if (!options) return null;
    var archive = groupByYearMonth();
    var partial = '<ul class="css-treeview" id="archive-partial">\n' +
        Object.keys(archive).map(function(y) {
            return ' <li>' + url(y) + '\n' + '  <ul>\n' +
                Object.keys(archive[y]).map(function(m) {
                    return '   <li>' + url(y + '/' + m, month[m]) + '\n' + '    <ul>\n' +
                        archive[y][m].map(function(p) {
                            var path = Path.join(settings.wwwPosts || 'post',
                                                 p.slug + '.html');
                            return '     <li>' + url(path, p.title) + '</li>';
                        }).join('\n') +
                        '\n    </ul>\n   </li>';
                }).join('\n') +
                '\n  </ul>\n </li>';
        }).join('\n') +
            '\n</ul>';
    
    if (options.save) {
        fs.outputFileSync(Path.join(settings.paths.www,
                               settings.paths.widgets, 'archive.html'), partial);
    }
    return partial;
}

function tagPartial(options) {
    if (!options) return null;
    var max = options.max;
    var tags = groupByTag();
    if (!max) max = Object.keys(tags).length;
    var partial =  '<ul id="by-tag-partial">\n' +
        Object.keys(tags)
        .sort(function(t1, t2) {
            var a = tags[t1].length;
            var b = tags[t2].length;
            if (a > b) return -1;
            if (a < b) return 1;
            return 0;
        })
        .slice(0,max)
        .map(function(t) {
            var path = Path.join(options.path || 'tag', t);
            return '  <li>' + '<a href="' + path + '">' + t + '</a> (' + tags[t].length + ')</li>';
        }).join('\n') +
        '\n</ul>';
    if (options.save) {
        fs.outputFileSync(Path.join(settings.paths.www,
                               settings.paths.widgets, 'tag.html'), partial);
    }
    return partial;
}

function getObject(obj, path) {
    var prop = path.shift();
    if (!path.length) return obj[prop];
    else return getObject(obj[prop], path);
}

// console.log(getObject({ a: { b: { c: 123}}}, ['a','b','cc', 'd']));

// function renderPage(config) {
    // var recipe = recipes[config.recipe] = recipes[config.recipe] ||
    //     evalFile(Path.join(settings.paths.base, config.recipe));
    //Set ids, but only if the the widget id already exists and there is a
    //widget for it:
    // var recipe = config.recipe;
    // Object.keys(recipe.partials.ids).forEach(function(id) {
    //     if (config.widgets[id]) {
    //         recipe.partials.ids[id] = config.widgets[id];
    //     }
    //     recipe.partials.ids.main = config.main;
        
    // });

    // log(util.inspect(recipe.partials.ids, {colors:true, depth:10}));
    // if (config.file) {
    //     var meta = posts[config.file];
        // try { source = getObject(recipe, config.source);
        //       target = getObject(recipe, config.target);
              
            
        //     } catch(e) {
        //     throw Error({ msg: 'Error in rendering page ' + meta.title, err: e });
        // }
        
        
    // }
//     return htmlBuilder(config());
// }
var Recipe;
var prepareRecipe = {
    post: function preparePostRecipe() {
        var recipeName = settings.pages.post.recipe || settings.recipe;
        var from, to, fromObj, toObj, fromProp, toProp;
        var recipe = evalFile(Path.join(settings.paths.base, recipeName));
        Recipe = recipe;
        from = settings.pages.post.from;
        to = settings.pages.post.to;
        // log(from);
        // log(to);
        try { fromObj = getObject(recipe, from.slice(0, from.length));
              toObj = getObject(recipe, to.slice(0, to.length));
            } catch(e) {
                throw Error({ msg: 'Error in preparing post recipe' , err: e });
            }
        fromObj= getObject(recipe, from.slice(0, from.length-1));
        fromProp= from[from.length-1];
        toObj= getObject(recipe, to.slice(0, to.length-1));
        toProp= to[to.length-1];
        log(fromObj, fromProp, toObj, toProp);
        
        return {
            setWidgets: function(widgets) {
                Object.keys(widgets).forEach(function(id) {
                        recipe.partials.ids[id] = widgets[id];
                });
                return recipe;
            },
            customize: function(from, to) {
                fromObj[fromProp] = from;
                toObj[toProp] = to;
                // log(fromObj, toObj);
                return recipe;
            }
        };
    }

}
function renderSite(posts, old, file) {
    postList = Object.keys(posts).map(function(k) { return posts[k]; });
    sortIndexListByDate();
    
    log('rendering site', file, postList);
    var widgets;
    if (settings.widgets)
        try {
            widgets = {
                tagWidget: tagPartial(settings.widgets.tag),
                recentWidget: recentPartial(settings.widgets.recent),
                archiveWidget: archivePartial(settings.widgets.archive)
            };
        } catch(e) {
            return VOW.broken({ msg: 'Failed to created widgets', err: e } );
        }
    
    if (!settings.pages) return VOW.kept();
    
    var toBeBuilt = []; 
    
    //POST page(s), TODO do only 'file' if file is defined and 
    //otherwise do all:
    recipes.post.setWidgets(widgets);
    var list = file ? [posts[file]] : postList;
    list.forEach(function(meta) {
        toBeBuilt.push(
            function() {
                return recipes.post.customize(
                    Path.join(settings.paths.posts, meta.file),
                    Path.join(settings.paths.www, settings.paths.wwwPosts, 
                              meta.slug + '.html'));
            }
        );
    });
    
    
    // log(util.inspect(Recipe, { depth:10, colors:true }));
    function recur() {
        if (toBeBuilt.length) {
            var recipe = (toBeBuilt.pop())();
            return htmlBuilder(recipe).when(
                recur
            );
        }
        else {
            // log(util.inspect(Recipe, { depth:10, colors:true }));
            return VOW.kept();
        }
    };
    var result =  recur();
    return result;
    
}
  
module.exports = {
    init: function(someSettings) {
        settings = someSettings;
        
        Object.keys(settings.pages)
            .filter(function(page) {
                return settings.pages[page];
            })
            .forEach(function(page) {
                if (prepareRecipe[page])
                    recipes[page] = prepareRecipe[page]();
            });
    
    },
    renderSite: renderSite
};
