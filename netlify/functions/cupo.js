const https = require('https');

const CUPO_EPI_ENDPOINT = 'https://servicios.aduanas.gub.uy/LuciaWS/awscupoepi.aspx';
const CNT_ENDPOINT      = 'https://servicios.aduanas.gub.uy/luciaws/aWSCntEncomiendasPostales.aspx';
const ENVIOS_POR_ANIO   = parseInt(process.env.ADUANAS_YEARLY_EXCEMPTIONS || '3');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) }; }

  const { documento, anio, monto } = body;
  if (!documento || !anio || monto === undefined) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos: documento, anio, monto' }) };
  }

  try {
    // Dos llamadas en paralelo — rapido y sin rate limiting
    const [cupoResult, enviosResult] = await Promise.all([
      consultarCupo(documento, anio, monto),
      consultarEnvios(documento, anio)
    ]);

    const enviosUsados    = enviosResult.cantEncomiendas;
    const enviosRestantes = Math.max(ENVIOS_POR_ANIO - enviosUsados, 0);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tieneCupo:      cupoResult.tieneCupo,
        errorCupo:      cupoResult.error,
        erroresCupo:    cupoResult.errores,
        enviosUsados,
        enviosRestantes,
        enviosPorAnio:  ENVIOS_POR_ANIO,
      }),
    };
  } catch (err) {
    console.error('Error:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'No se pudo conectar con Aduana', detalle: err.message }),
    };
  }
};

async function consultarCupo(documento, anio, monto) {
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
  const xml     = await soapRequest(CUPO_EPI_ENDPOINT, soap);
  const tieneCupo = extractTag(xml, 'Tienecupo');
  const error     = extractTag(xml, 'Error');
  const errores   = extractTag(xml, 'Errores');
  return { tieneCupo, error, errores };
}

async function consultarEnvios(documento, anio) {
  const soap = `<?xml version="1.0" encoding="utf-8"?>
<s11:Envelope xmlns:s11="http://schemas.xmlsoap.org/soap/envelope/"
              xmlns:wsdlns="www.aduanas.gub.uy/WSCntEncomiendasPostales">
  <s11:Header/>
  <s11:Body>
    <wsdlns:WSCntEncomiendasPostales.Execute>
      <wsdlns:Documento>${documento}</wsdlns:Documento>
      <wsdlns:Anio>${anio}</wsdlns:Anio>
    </wsdlns:WSCntEncomiendasPostales.Execute>
  </s11:Body>
</s11:Envelope>`;
  const xml     = await soapRequest(CNT_ENDPOINT, soap);
  const cant    = extractTag(xml, 'Cantencomiendas');
  const errores = extractTag(xml, 'Errores');
  if (cant !== null) return { cantEncomiendas: parseInt(cant) || 0, error: null };
  return { cantEncomiendas: 0, error: errores };
}

function soapRequest(url, soap) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const usuario   = process.env.ADUANA_USUARIO;
    const password  = process.env.ADUANA_PASSWORD;
    const creds     = Buffer.from(`${usuario}:${password}`).toString('base64');
    const options   = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname,
      method:   'POST',
      headers: {
        'Accept':         'application/xml',
        'Content-Type':   'application/xml',
        'Authorization':  `Basic ${creds}`,
        'Content-Length': Buffer.byteLength(soap),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(soap);
    req.end();
  });
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>\\s*(.*?)\\s*<\\/${tag}>`, 's'));
  return match ? match[1].trim() : null;
}
