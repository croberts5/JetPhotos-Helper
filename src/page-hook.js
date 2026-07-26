/* ---- XHR ---- */
const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._method = method;
    this._url = url;
    return open.call(this, method, url, ...rest);
};

const send = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', function () {
        if (this._method === 'POST') {
            sendToExtension({
                type: 'POST_RESPONSE',
                url: this._url,
                body: this.responseText
            });
        }

        if (this._method === 'GET' && String(this._url).includes('census.php')) {
            sendToExtension({
                type: 'CENSUS_RESPONSE',
                url: this._url,
                body: this.responseText
            });
        }
    });
    return send.call(this, body);
};

function sendToExtension(payload) {
    window.postMessage(
        {
            source: 'POST_HOOK',
            payload
        },
        '*'
    );
}