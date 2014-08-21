var Path = require('path');
var log = require('logthis').logger._create(Path.basename(__filename));
  
var settings;
var indexList;
var teasers = {};
var recipes = {};
var outPath;
  
var VOW = require('dougs_vow');
var moment = require('moment');
var fs = require('fs-extra');
var util = require('util');
var htmlBuilder = require('html-builder').build;
  
  
  
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
    indexList.sort(function compare(p1, p2) {
        var a = p1.published;
        var b = p2.published;
        if (a > b)
            return -1;
        if (a < b)
            return 1;
        // a must be equal to b
        return 0;
    });
}

function renderSite(index, someSettings) {
    settings = someSettings;
    // log(post);
    // if (typeof key !== 'undefined' && typeof post !== 'undefined') {
    //     //carry out instructions in meta
    // }
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
  

module.exports = {
    renderSite: renderSite
};
