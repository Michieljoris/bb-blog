
//TEST -=================================================
// module.exports.init({
//     //build dir of blog repo
//     basePath: '../../blog/build',
//     auth: false
// });

// console.log(settings);


// var synergipsum = require('synergipsum');
// function lorem(maxParagraphs) {
//     if (maxParagraphs <= 0) return '';
//     var min = 3, max  = 6;
//     var result = [];
//     while (maxParagraphs--) {
//         var paragraphLength = min + Math.floor(Math.random()*(max+1-min));
//         var generator = synergipsum.create(paragraphLength);
//         result.push('<p>' + generator.generate() + '</p>');
//     }
//     return result.join('\n');
// }

// console.log(lorem(3));

// indexList = [
//     { title: 'Some title', publishedat: new Date('11/May/2010')  ,tags: ["a", "b", "d"]},
//     { title: 'What is this about', publishedat: new Date('20/Oct/2010') ,tags: ["c", "b", "d"]},
//     { title: 'A very important post', publishedat: new Date('12/Oct/2010')  ,tags: ["d", "a"]},
//     { title: 'Oh, I do blabber on', publishedat: new Date('12/Jan/2011')  ,tags: ["d", "a"]},
//     { title: 'Now what?', publishedat: new Date('12/Feb/2012')  ,tags: ["d", "a"]}
// ];



// var teaserList = [
//     { title: 'abc', publishedat: new Date('11/May/2010')  ,tags: ["a", "b", "d"]},
//     { title: 'def', publishedat: new Date('20/Oct/2010') ,tags: ["c", "b", "d"]},
//     { title: 'ghi', publishedat: new Date('12/Oct/2010')  ,tags: ["d", "a"]},
//     { title: 'ghi2', publishedat: new Date('12/Jan/2011')  ,tags: ["d", "a"]},
//     { title: 'ghir', publishedat: new Date('12/Feb/2012')  ,tags: ["d", "a"]}
// ];
// indexList.forEach(function(t) {
//     teasers[t.title] = t.tags.join('-');
//     t.slug = t.title.toLowerCase().replace(/ /g, '-').replace(/[^A-Za-z0-9_-]/g, '');
// });

// var result = createListing(Path.join(settings.basePath, settings.posts));
// log(result);


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


// var str =
//    "<pre>publish: no\n\
// created: 20/Jan/2013,\n\
// published: 20 March 2000\
// tags: tag1 tag2\n\
// categories: cat1,cat2asdfasf\n\
// comments: yesfsadfasdfasd\n\
// delete: yes</pre><p>bla\n\
// \n\
// asdfasdfasdftest]</p><pre>-------</pre><p>End of post</p><p>------</p><p>\n\
// </p>";

// var r = parseMetaData(str);

// log(getPreBlocks(str));
// log(r);
