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

console.log(lorem(2));
  
  
