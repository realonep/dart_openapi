const https = require('https');

function requestJson(url, params, apiKey) {
  const search = new URLSearchParams({ crtfc_key: apiKey, ...params }).toString();
  const fullUrl = `${url}?${search}`;

  return new Promise((resolve, reject) => {
    https
      .get(fullUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

module.exports = {
  requestJson,
};

