var WebSocket = require('ws');
var websocket;

var test;

//This little module opens a connection to URL, when opened executes fun and
//returns a function that can send the reload msg to the open websocket at URL.
module.exports = {
    onOpen: function(URL, fun) {
        enableWebsocket(URL);
        test = fun;
        return reload;
    }
};

function reload() {
    console.log('sending reload');
    websocket.send('reload');
    websocket.close();
}

function enableWebsocket(URL) {
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
            //Call test function here-----------------------------------
            test();
            //Call test function here-----------------------------------
            
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


  
