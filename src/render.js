var Path = require('path');

var log = require('logthis').logger._create(Path.basename(__filename));
var util = require('util');

var VOW = require('dougs_vow');
var moment = require('moment');
var fs = require('fs-extra');
var extend = require('extend');
var htmlBuilder = require('html-builder').build;

// var webSocketConnection = require('./server-connection');

var monthByName = [ 'January', 'February', 'March', 'April', 'May', 'June', 'July',
              'August', 'September', 'October', 'November', 'December'];

//module state:
var settings;
var recipeCache;
var recipes;

//returns object with posts grouped by tag
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

//returns object with posts grouped by year and month
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

//returns list of html blobs, with each blob containing a max of n number of teasers
function pagedTeasers(posts, n) {
    function postIterator(posts, n) {
        return function() {
                var slice = posts.slice(0,n);
            posts = posts.slice(n);
            return slice;
        };
    }
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
            var path = Path.join(settings.pages.post.path, post.slug +
                                settings.pages.post.ext);
            return '<div class="box teaser">\n' + '<h2>' + post.title + '</h2>\n' + post.teaser +
                '\n<span class="more-blog"><a href="/' + path + '">More</a></span>\n</div>';
        }).join('\n');
        pages.push(page);
    });
    return pages;
}


//used to evaluate a recipe, and returns an object.
//recipe should be a json perhaps, however writing a js file is much easier, since on
//execution it can modify itself somewhat.
//another option is to use require perhaps, but a new require returns the same object, and doesn't revaluate the file. Also path resolution can be tricky.
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

//returns a sorted list of posts
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

//returns an html string of a recent widget
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
            var path = Path.join(settings.pages.post.path || 'post', p.slug +
                                settings.pages.post.ext);
            return '  <li>' + '<a href="/' + path + '">' + p.title + '</a></li>';
        }).join('\n') +
        '\n</ul>';

    if (options.save) {
        fs.outputFileSync(Path.join(settings.paths.www,
                                    settings.paths.widgets, 'recent.html'), partial);
    }
    return partial;
}


//returns an html string of a archive widget
function archivePartial(archive, options) {
    function url(link, text) {
        return '<a  href="/' + link + '" >'  + (text || link) + '</a>';
    }
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
                                                 p.slug + settings.pages.post.ext);
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

//returns an html string of a tag widget
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
            var path = Path.join(settings.pages.tag.path || 'tag', t);
            return '  <li>' + '<a href="/' + path + '">' + t + '</a> (' + tags[t].length + ')</li>';
        }).join('\n') +
        '\n</ul>';
    if (options.save) {
        fs.outputFileSync(Path.join(settings.paths.www,
                                    settings.paths.widgets, 'tag.html'), partial);
    }
    return partial;
}

//retrieve value from object using path
//path is an array of keys
function getObject(obj, path) {
    var prop = path.shift();
    if (!path.length) return obj[prop];
    else return getObject(obj[prop], path);
}

//assign widgets to ids in a recipe
//widgets is an array of strings of html;
function setWidgets(recipe, widgets) {
    Object.keys(widgets).forEach(function(id) {
        recipe.partials.ids[id] = widgets[id];
    });
    return recipe;
}


//takes an object describing an html element and returns that html element as a
//string
//the object looks like:

// var html = { tag:"header",
//            inner: [
//                { tag: 'h1', 'class':'title',
//                  inner: "Some text" },
//            ]};
function htmlizeObject(obj) {
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


//returns an html string for a pagination navigation bar, with n being the
//number of pages and c being the current page
//links look like this,
//1 -> basePath
//2 -> basePath/2
//..
//n -> basePath/n
// with prev and next pointing to the basePath/c-1 and basePath/c+1 pages:
function pageNav(basePath, n, c) {
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
    return htmlizeObject(html);
}

//returns list of functions that when executed return a recipe to be built.
//pageType is archive/post/landing
//pageTitle is inserted in recipe
//pages are blobs of html, and are inserted in recipe.
function addPages(pageType, pageTitle, pages, basePath) {
    // var toBeBuilt = [];
    basePath = basePath.slice(settings.paths.www.length) || '/';
    log('*************************',basePath);
    return pages.map(function(page, i) {
        // toBeBuilt.push(
        return function() {
            var path = i === 0 ?
                Path.join(basePath, 'index.html') :
                Path.join(basePath, 'page' + (i+1), 'index.html');
            var pageNumber = i === 0 ? '' : '/' + (i+1);
            page += pageNav(basePath, pages.length, i);
            return recipes[pageType].customize(pageTitle + pageNumber,
                                               page, path);
        };
        // );
    });
    // return toBeBuilt;
}

// <header>
//   <div class="icon"></div>
//   <time datetime="2014-06-02T12:33:28.000Z">
//     <a href="/Meteor,-docs-and-attached-files/">Jun 2 2014</a></time>
//   <h1 class="title"><a href="/Meteor,-docs-and-attached-files/"> Meteor, docs and attached files</a></h1>
// </header>

//returns a string of html for a header of a post
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
    return htmlizeObject(html);
}


//builds widgets and then post, landing, tag and archive pages
//using an object with all posts by slug/title
//file refers to a potentially modified/deleted/create post, this is handy since
//if we know what changed we might not need to recreate all pages.
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
    log('Widgets made');
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
                    //TODO little hack, could be done better, by using different
                    //recipes or modifying the post recipe when used to create
                    //the post page
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
        basePath = settings.pages.landing.path || '';
        var outPath = Path.join(settings.paths.www, basePath);
        log('outpath for landing:', outPath, settings.paths.www);
        toBeBuilt = toBeBuilt.concat(addPages("landing", 'Latest', subPages, outPath));
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
    log('Rendering blog pages');

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

//-----------------init-------------------------

//fetches appropriate recipe for a pageType (archive/post/landing/tag).
//the recipe can be had by calling get on the returned object and
//customized to some degree by calling customize on the returned object
function fetchRecipe(pageType) {
    var recipeName = //settings.pages[page].recipe || settings.recipe;
    (settings.pages[pageType].recipe && settings.pages[pageType].recipe[settings.renderMode]) ||
        settings.pages[pageType].recipe ||
        settings.recipe[settings.renderMode] || settings.recipe;
    if (!recipeName) log._e('No recipe specified for page ' + pageType);
    var from, to, fromObj, toObj, fromProp, toProp;
    var recipe = recipeCache[recipeName] = recipeCache[recipeName] ||
        evalFile(Path.join(settings.paths.base, recipeName));
    // console.log('recipe',recipe);
    if (!recipe || !Object.keys(recipe).length) log._e('Error: Recipe non-existant for ' + recipeName + ' for page ' + pageType);
    from = settings.pages[pageType].from || settings.from;
    to = settings.pages[pageType].to || settings.to;
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
        //set the some props of the recipe as set in the configuration of the
        //blog:
        customize: function(from, to, title) {
            if (from) fromObj[fromProp] = from;
            if (to) toObj[toProp] = to;
            recipe.partials.ids.pageTitle = title;
            return recipe;
        },
        //little hack to enable/disable comments for a post
        getFromObj: function() {
            return fromObj;
        }
    };
    
}

//default recipe preparer:
function prepareRecipe(pageType) {
    var recipe =  fetchRecipe(pageType);
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

//used by the module's init function to create the recipes for the different pages:
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
    // ,landing : prepareRecipe
    // ,tag : prepareRecipe
    // ,archive : prepareRecipe
};


module.exports = {
    //
    init: function(someSettings) {
        settings = someSettings;
        //TODO do the same for landing,archive and tag:
        if (typeof settings.pages.post === 'string')
            settings.pages.post = { path: settings.pages.post }; 
        else if (settings.pages.post && typeof settings.pages.post === 'boolean')
            settings.pages.post = { path: 'post' }; 
        if (!settings.pages.post.ext) settings.pages.post.ext = '';
        
        recipes = {};
        recipeCache = {};

        Object.keys(settings.pages)
            .filter(function(pageType) {
                return settings.pages[pageType];
            })
            .forEach(function(pageType) {
                recipes[pageType] = recipePreparers[pageType] ? 
                    recipePreparers[pageType]() : prepareRecipe(pageType);
                // if (recipePreparers[page])
                //     recipes[page] = recipePreparers[page]();
            });

    },
    renderSite: renderSite
};





