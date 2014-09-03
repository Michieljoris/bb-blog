var Path = require('path');

var log = require('logthis').logger._create(Path.basename(__filename));
var util = require('util');

var VOW = require('dougs_vow');
var moment = require('moment');
var fs = require('fs-extra');
var extend = require('extend');
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
            var path = Path.join(settings.pages.post.path, post.slug + '.html');
            return '<div class="box teaser">\n' + '<h2>' + post.title + '</h2>\n' + post.teaser +
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
        .slice()
        .reverse()
        .filter(function(p) {
            return !filterAttr || p[filterAttr];
        })
        .slice(0,n).map(function(p) {
            var path = Path.join(settings.pages.post.path || 'post', p.slug + '.html');
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
    var basePath = settings.pages.archive.path || 'archive';
    var partial = '<ul class="css-treeview" id="archive-partial">\n' +
        Object.keys(archive).map(function(y) {
            return ' <li>' + url(Path.join(basePath, y), y) + '\n' + '  <ul>\n' +
                Object.keys(archive[y]).map(function(m) {
                    return '   <li>' + url(Path.join(basePath, y + '/' + monthByName[m]),
                                           monthByName[m]) + '\n' + '    <ul>\n' +
                        archive[y][m].map(function(p) {
                            var path = Path.join(settings.pages.post.path || 'post',
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
        // settings.pages[page].recipe[settings.renderMode] ||
        // settings.pages[page].recipe ||
        // settings.recipe[settings.renderMode] || settings.recipe;
function fetchRecipe(page) {
    var recipeName = //settings.pages[page].recipe || settings.recipe;
    (settings.pages[page].recipe && settings.pages[page].recipe[settings.renderMode]) ||
        settings.pages[page].recipe ||
        settings.recipe[settings.renderMode] || settings.recipe;
    if (!recipeName) log._e('No recipe specified for page ' + page);
    var from, to, fromObj, toObj, fromProp, toProp;
    var recipe = recipeCache[recipeName] = recipeCache[recipeName] ||
        evalFile(Path.join(settings.paths.base, recipeName));
    console.log('recipe',recipe);
    if (!recipe || !Object.keys(recipe).length) log._e('Error: Recipe non-existant for ' + recipeName + ' for page ' + page);
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
            return recipe;
        },
        getFromObj: function() {
            return fromObj;
        }
    };
    
}

function prepareRecipe() {
    var recipe =  fetchRecipe("landing");
    var customize = recipe.customize;
    recipe.customize = function(title, main, to) {
        var recipe = customize(null, to, title);
        recipe.partials.ids.main = main;
        recipe.partials.ids['meta-page-title'] =
            '<title>' + (settings.siteTitle || 'blog') + '-' + 
            title + '</title>;';
        return recipe;
    };
    // log(util.inspect(recipe.get(), { depth:10, colors:true }));
    return recipe;
}

var recipePreparers = {
    post: function preparePostRecipe() {
        var recipe =  fetchRecipe("post");
        var customize = recipe.customize;
        recipe.customize = function(from, to, meta) {
            var recipe = customize(from, to, postHeader(meta));
            recipe.partials.ids['meta-page-title'] =
                '<title>' + (settings.siteTitle || 'blog') + '-' + 
                meta.title + '</title>;';
            return recipe;
        };
        return recipe;
        
    }
    ,landing : prepareRecipe
    ,tag : prepareRecipe
    ,archive : prepareRecipe
};

function stringifyHtml(obj) {
    function attr(obj) {
        return Object.keys(obj).map(function(key) {
            return key + '="' + obj[key] + '"';
        }).join(' ');
    }
    function tag(indent, obj) {
        if (typeof obj !== 'object') return obj; //just don't pass an array..
        var inner = obj.inner || '';
        var t = obj.tag;
        var str =  indent + '<' + t + ' ';
        var lf = '\n';
        if (!util.isArray(inner)) { inner = [inner];
                                    lf = '';  }
        inner = inner.map(function(el) {
            return tag(indent + '  ', el);
        }).join('\n');
        delete obj.tag; delete obj.inner;
        return  str + attr(obj) + '>' + lf + indent + inner + lf + indent + '</' + t + '>';
    }
    var indent = '';
    return tag(indent, obj); 
}


function pageNav(basePath, n, c) {
    basePath = basePath.slice(settings.paths.www.length) || '/';
    if (n <= 1) return '';
    var html = { tag: 'nav', id: 'page-nav',
                 inner: (function() {
                     var links =  [];
                     var prevLinkHref = Path.join(basePath, c>1 ? 'page' + c: '');
                     var prevLink = 
                         {tag: 'a', "class":"extend prev", href: prevLinkHref,
                          inner: "« Prev" };
                     if (c+1 !== 1) links.push(prevLink);
                     var link = { tag: 'a', "class":"page-number", href: basePath,
                                  inner: '' };
                     var span = { tag: 'span', 'class': 'page-number current', inner: c+1 };
                     for (var i=1; i<=n; i++) {
                         var newLink = extend(true, {}, link);
                         newLink.href = Path.join(basePath, i>1 ? 'page' + i: '');
                         newLink.inner = i;
                         links.push( c+1 === i ? span: newLink);
                     }
                     var nextLinkHref = Path.join(basePath, '' + 'page' +(c+2));
                     var nextLink = { tag: 'a', "class":"extend next",
                                      href: nextLinkHref,
                                      inner: "Next »" };
                     if (c+1 !== n) links.push(nextLink);
                     return links;
                 })()
               };
    return stringifyHtml(html);
}

// console.log(pageNav('basepath', 4, 2));

function addPages(pageType, pageTitle, subpages, basePath) {
    var toBeBuilt = [];
    subpages.forEach(function(page, i) {
        toBeBuilt.push(
            function() {
                var path = i === 0 ?
                    Path.join(basePath, 'index.html') :
                    Path.join(basePath, 'page' + (i+1), 'index.html');
                var pageNumber = i === 0 ? '' : '/' + (i+1);
                page += pageNav(basePath, subpages.length, i);
                return recipes[pageType].customize(pageTitle + pageNumber,
                                                   page, path);
            }
        );
    });
    return toBeBuilt;
}

// <header>
//   <div class="icon"></div>
//   <time datetime="2014-06-02T12:33:28.000Z">
//     <a href="/Meteor,-docs-and-attached-files/">Jun 2 2014</a></time>
//   <h1 class="title"><a href="/Meteor,-docs-and-attached-files/"> Meteor, docs and attached files</a></h1>
// </header>

function postHeader(meta) {
    // var href = meta.slug + '.html';
    var datetime = moment(meta.publishedat).format('Do of MMMM YYYY');
    var html = { tag:"header",
               inner: [
                   { tag: 'h1', 'class':'title',
                     inner: meta.title },
                   { tag: 'time', datetime:datetime, inner: datetime }
                     // inner: [
                     //     {tag: 'a', href:href, inner:'Jan 1 1970'}
                     // ]}
                     // inner: [
                         // {tag: 'a', href:href, inner: meta.title}
                     // ]}
               ]};
    return stringifyHtml(html);
}

function renderSite(posts,  file) {
    var postList = Object.keys(posts).map(function(k) { return posts[k]; });
    log('rendering site', file, posts[file], postList);
    
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
        //don't regenerate all posts if only one post has been updated, but do so
        //in the case of a new file, deleted file or changed title, since it
        //changes the widgets on the other posts.
        var list = postList;
        if (file) {
            if (posts[file]._all) delete posts[file]._all;
            else list = [posts[file]];
        }
        list.forEach(function(meta) {
            toBeBuilt.push(
                function() {
                    var fromObj = recipes.post.getFromObj();
                    if ((!settings.enableCommentsPerPost && !settings.comments) ||
                        (settings.enableCommentsPerPost && !meta.comments)) {
                        log(meta, '--------------------------------------');
                        delete fromObj['disqus-embed'];
                        delete fromObj['disqus-count'];
                    }
                    else {
                        fromObj['disqus-embed'] = 'html/disqus-embed.html';
                        fromObj['disqus-count'] = 'html/disqus-count.html';
                    }
                    return recipes.post.customize(
                        Path.join(settings.paths.posts, meta.file),
                        Path.join(settings.paths.www, settings.pages.post.path || 'post', 
                                  meta.slug + '.html'),
                        meta
                        // postHeader(meta)
                    );
                }
            );
        });
    }

    var basePath;
    var subPages;
    //LANDING page(s)
    if (recipes.landing) {
        //TODO remove all the dirs that are just a number, as in they might be stale
        //never remove www/index.html, since it is the landing page.
        //even better generate an empty landing index.html page even when there no posts
        subPages = pagedTeasers(postList, settings.pagination);
        basePath = settings.paths.www || 'www';
        toBeBuilt = toBeBuilt.concat(addPages("landing", 'Latest', subPages, basePath));
    }

    //TAG page(s)
    if (recipes.tag) {
        if (settings.pages.tag.path)
            fs.removeSync(Path.join(settings.paths.www, settings.pages.tag.path));
        basePath = settings.pages.tag.path || 'tag';
        Object.keys(tags).forEach(function(tag) {
            var subPages = pagedTeasers(tags[tag], settings.pagination);
            var outPath = Path.join(settings.paths.www, basePath, tag);
            toBeBuilt = toBeBuilt.concat(addPages('tag', tag, subPages, outPath));
        });
        // subPages = pagedTeasers(postList, settings.pagination);
    }

    //YEAR and MONTH page(s)
    if (recipes.archive){
        if (settings.pages.archive.path)
            fs.removeSync(Path.join(settings.paths.www, settings.pages.archive.path));
        basePath = settings.pages.archive.path || 'archive';
        Object.keys(archive).forEach(function(year) {
            var postsByYear = [];
            Object.keys(archive[year]).forEach(function(month) {
                log(year, month, archive);
                var postsByMonth = archive[year][month];
                var subPages = pagedTeasers(postsByMonth, settings.pagination);
                var outPath = Path.join(settings.paths.www, basePath,
                                        year, monthByName[month]);
                toBeBuilt = toBeBuilt.concat(addPages('archive', monthByName[month] ,
                                                      subPages, outPath));
                postsByYear = postsByYear.concat(archive[year][month]);
            });    
            var subPages = pagedTeasers(postsByYear, settings.pagination);
            var outPath= Path.join(settings.paths.www, basePath, year);
            toBeBuilt = toBeBuilt.concat(addPages('archive', year, subPages, outPath));
        });
    }

    // //ARCHIVE page
    // if (recipes.archive) {

    // }

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
        
        if (typeof settings.pages.post === 'boolean')
            settings.pages.post = { path: 'post' };
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





