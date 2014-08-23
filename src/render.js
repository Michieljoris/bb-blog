var Path = require('path');

var log = require('logthis').logger._create(Path.basename(__filename));
var util = require('util');

var VOW = require('dougs_vow');
var moment = require('moment');
var fs = require('fs-extra');
var htmlBuilder = require('html-builder').build;

// var webSocketConnection = require('./server-connection');

//module state:
var settings;
var recipeCache;
var recipes;


function groupByTag(postList, filterAttr) {
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

function groupByYearMonth(postList, filterAttr) {
    var archive = {};
    postList
        .filter(function(p) {
            return !filterAttr || p[filterAttr];
        })
        .forEach(function(p) {
            // if (p.publishedat) {
                var m = moment(p.publishedat || new Date());
                var year = m.year();
                var month = m.month();
                archive[year] = archive[year] || {};
                archive[year][month] = archive[year][month] || [];
                archive[year][month].unshift(p);
            // }
        });
    return archive;
}
var monthByName = [ 'January', 'February', 'March', 'April', 'May', 'June', 'July',
              'August', 'September', 'October', 'November', 'December'];


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
    var pages = [];
    pagedPosts.forEach(function(posts) {
        var page = posts.map(function(post) {
            var path = Path.join(settings.paths.wwwPosts, post.slug + '.html');
            return '<div class="teaser">\n' + '<h2>' + post.title + '</h2>\n' + post.teaser +
                '\n<span class="more"><a href="/' + path + '">More</a></span>\n</div>';
        }).join('\n');
        pages.push(page);
    });
    return pages;
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

function sortIndexListByDate(postList) {
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

function recentPartial(postList, options, filterAttr) {
    if (!options) return null;
    var n = options.max;
    var partial = '<ul id="most-recent-partial">\n' +
        postList
        .filter(function(p) {
            return !filterAttr || p[filterAttr];
        })
        .slice(0,n).map(function(p) {
            var path = Path.join(settings.wwwPosts || 'post', p.slug + '.html');
            return '  <li>' + '<a href="/' + path + '">' + p.title + '</a></li>';
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

function archivePartial(archive, options) {
    if (!options) return null;
    var partial = '<ul class="css-treeview" id="archive-partial">\n' +
        Object.keys(archive).map(function(y) {
            return ' <li>' + url(y) + '\n' + '  <ul>\n' +
                Object.keys(archive[y]).map(function(m) {
                    return '   <li>' + url(y + '/' + monthByName[m], monthByName[m]) + '\n' + '    <ul>\n' +
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

function tagPartial(tags, options) {
    if (!options) return null;
    var max = options.max;
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
            return '  <li>' + '<a href="/' + path + '">' + t + '</a> (' + tags[t].length + ')</li>';
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

function setWidgets(recipe, widgets) {
    Object.keys(widgets).forEach(function(id) {
        recipe.partials.ids[id] = widgets[id];
    });
    return recipe;
}

function fetchRecipe(page) {
    var recipeName = settings.pages[page].recipe || settings.recipe;
        var from, to, fromObj, toObj, fromProp, toProp;
    var recipe = recipeCache[recipeName] = recipeCache[recipeName] ||
        evalFile(Path.join(settings.paths.base, recipeName));
    from = settings.pages[page].from || settings.from;
    to = settings.pages[page].to || settings.to;
    try { fromObj = getObject(recipe, from.slice(0, from.length));
          toObj = getObject(recipe, to.slice(0, to.length));
        } catch(e) {
            log._e('Error in preparing post recipe', e);
            // throw Error({ msg: 'Error in preparing post recipe' , err: e });
        }
    fromObj= getObject(recipe, from.slice(0, from.length-1));
    fromProp= from[from.length-1];
    toObj= getObject(recipe, to.slice(0, to.length-1));
    toProp= to[to.length-1];

    return {
        get: function() { return recipe; },
        customize: function(from, to, title) {
            if (from) fromObj[fromProp] = from;
            if (to) toObj[toProp] = to;
            recipe.partials.ids.pageTitle = title;
            // log(fromObj, toObj);
            return recipe;
            }
        };
}

function prepareRecipe() {
        var recipe =  fetchRecipe("landing");
        var customize = recipe.customize;
        recipe.customize = function(title, main, to) {
           var recipe = customize(null, to, title);
            recipe.partials.ids.main = main;
            return recipe;
        };
        // log(util.inspect(recipe.get(), { depth:10, colors:true }));
        return recipe;
    }

var recipePreparers = {
    post: function preparePostRecipe() {
        return fetchRecipe("post");
    }
    ,landing : prepareRecipe
    ,tag : prepareRecipe
    ,year : prepareRecipe
    ,month : prepareRecipe
};

function pageNav(n, i) {
    if (n === 1) return '';
    
    // var html =  "<div id='page-nav'>" +  Previous Next Last" + "</div>";
    // '<nav id="page-nav">'
    //       '<a class="extend prev" href="/hexo-theme-landscape/">« Prev</a><a class="page-number" href="/hexo-theme-landscape/">1</a><span class="page-number current">2</span><a class="page-number" href="/hexo-theme-landscape/page/3/">3</a><a class="extend next" href="/hexo-theme-landscape/page/3/">Next »</a>
    //     </nav>
    
}


function addPages(pageType, pageTitle, subpages, basePath) {
    log('-------------- adding subpages for ' + pageTitle);
    var toBeBuilt = [];
    subpages.forEach(function(page, i) {
        toBeBuilt.push(
            function() {
                //TODO add first,prev,next,last links to 'page'
                var path = i === 0 ?
                    Path.join(basePath, 'index.html') :
                    Path.join(basePath, 'page' + (i+1), 'index.html');
                var pageNumber = i === 0 ? '' : '/' + (i+1);
                page += pageNav(subpages.length, i);
                return recipes[pageType].customize(pageTitle + pageNumber,
                                                   page, path);
            }
        );
    });
    return toBeBuilt;
}

function renderSite(posts, old, file) {
    var postList = Object.keys(posts).map(function(k) { return posts[k]; });
    log('rendering site', file, postList);
    
    var archive = groupByYearMonth(postList);
    var tags = groupByTag(postList);
    sortIndexListByDate(postList);
    
    //WIDGETS
    var widgets;
    if (settings.widgets)
        try {
            widgets = {
                tagWidget: tagPartial(tags, settings.widgets.tag),
                recentWidget: recentPartial(postList, settings.widgets.recent),
                archiveWidget: archivePartial(archive, settings.widgets.archive)
            };
        } catch(e) {
            return VOW.broken({ msg: 'Failed to created widgets', err: e } );
        }

    //modify all recipes so they contain the just created widgets
    Object.keys(recipes)
        .forEach(function(page) {
            setWidgets(recipes[page].get(), widgets);
        });

    var toBeBuilt = [];

    //POST page(s),
    if (recipes.post) {
        var list = file && posts[file].title === old.title ?
            [posts[file]] : postList;
        list.forEach(function(meta) {
            toBeBuilt.push(
                function() {
                    return recipes.post.customize(
                        Path.join(settings.paths.posts, meta.file),
                        Path.join(settings.paths.www, settings.paths.wwwPosts,
                                  meta.slug + '.html'),
                        meta.title);
                }
            );
        });
    }

    var subPages;
    //LANDING page(s)
    if (recipes.landing) {
        subPages = pagedTeasers(postList, settings.pagination);
        var basePath = settings.paths.www;
        toBeBuilt = toBeBuilt.concat(addPages("landing", 'Latest', subPages, basePath));
    }

    //TAG page(s)
    if (recipes.tag) {
        Object.keys(tags).forEach(function(tag) {
            var subPages = pagedTeasers(tags[tag], settings.pagination);
            var basePath = settings.pages.tag.path || '';
            basePath = Path.join(settings.paths.www, basePath, tag);
            toBeBuilt = toBeBuilt.concat(addPages('tag', tag, subPages, basePath));
        });
        // subPages = pagedTeasers(postList, settings.pagination);
    }

    //YEAR and MONTH page(s)
    if (recipes.year){
        Object.keys(archive).forEach(function(year) {
            var postsByYear = [];
            Object.keys(archive[year]).forEach(function(month) {
                log(year, month, archive);
                var postsByMonth = archive[year][month];
                log(postsByMonth.length);
                var subPages = pagedTeasers(postsByMonth, settings.pagination);
                var basePath = settings.pages.month.path || '';
                basePath = Path.join(settings.paths.www, basePath, year, monthByName[month]);
                toBeBuilt = toBeBuilt.concat(addPages('month', monthByName[month] ,
                                                      subPages, basePath));
                postsByYear = postsByYear.concat(archive[year][month]);
            });    
            var subPages = pagedTeasers(postsByYear, settings.pagination);
            var basePath = settings.pages.year.path || '';
            basePath = Path.join(settings.paths.www, basePath, year);
            toBeBuilt = toBeBuilt.concat(addPages('year', year, subPages, basePath));
        });
    }

    //ARCHIVE page
    if (recipes.archive) {

    }

    function recur() {
        if (toBeBuilt.length) {
            var recipe = (toBeBuilt.pop())();
            return htmlBuilder(recipe).when(
                recur
            );
        }
        else {
            return VOW.kept();
        }
    }
    var result =  recur();
    return result;

}

module.exports = {
    init: function(someSettings) {
        settings = someSettings;
        recipes = {};
        recipeCache = {};

        Object.keys(settings.pages)
            .filter(function(page) {
                return settings.pages[page];
            })
            .forEach(function(page) {
                if (recipePreparers[page])
                    recipes[page] = recipePreparers[page]();
            });

    },
    renderSite: renderSite
};

