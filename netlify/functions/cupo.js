const https = require('https');

const ADUANA_ENDPOINT = 'https://servicios.aduanas.gub.uy/LuciaWS/awscupoepi.aspx';
const SOAP_ACTION = 'www.aduanas.gub.uy/WSCupoEPIaction/AWSCUPOEPI.Execute';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  const { documento, anio, monto } = body;
  if (!documento || !anio || monto === undefined) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos: documento, anio, monto' }) };
  }

  const soap = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsc="www.aduanas.gub.uy/WSCupoEPI">
  <soapenv:Header/>
  <soapenv:Body>
    <wsc:WSCupoEPI.Execute>
      <wsc:Documento>${documento}</wsc:Documento>
      <wsc:Anio>${anio}</wsc:Anio>
      <wsc:Montodolaresepi>${monto}</wsc:Montodolaresepi>
    </wsc:WSCupoEPI.Execute>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const xmlResponse = await soapRequest(soap);
    console.log('Respuesta Aduana:', xmlResponse);
    const tieneCupo = extractTag(xmlResponse, 'Tienecupo');
    const error     = extractTag(xmlResponse, 'Error');
    const errores   = extractTag(xmlResponse, 'Errores');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tieneCupo, error, errores }),
    };
  } catch (err) {
    console.log('Error:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'No se pudo conectar con Aduana', detalle: err.message }),
    };
  }
};

function soapRequest(soap) {
  return new Promise((resolve, reject) => {
    const url = new URL(ADUANA_ENDPOINT);
    const usuario = process.env.ADUANA_USUARIO;
    const password = process.env.ADUANA_PASSWORD;
    const credenciales = Buffer.from(`${usuario}:${password}`).toString('base64');

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': SOAP_ACTION,
        'Content-Length': Buffer.byteLength(soap),
        'Authorization': `Basic ${credenciales}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(soap);
    req.end();
  });
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(.*?)<\\/${tag}>`, 's'));
  return match ? match[1].trim() : null;
}
