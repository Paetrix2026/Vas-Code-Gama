import { generateKeyPairSync } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, 'cert');
mkdirSync(dir, { recursive: true });

// Node.js 19+ has X509Certificate generation via crypto
// For older versions, we use a different approach
try {
  // Try using node:crypto experimental generateCertificate (not available)
  // Fallback: use forge-style approach with node-forge
  throw new Error('use fallback');
} catch {
  // Use node-forge which is a pure JS crypto library
  const forge = await import('node-forge');
  const pki = forge.default?.pki || forge.pki;
  
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);
  
  const attrs = [
    { name: 'commonName', value: 'VoiceRideApp' },
    { name: 'organizationName', value: 'Dev' },
    { name: 'countryName', value: 'IN' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  
  // Add extensions for modern browsers
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: 'subjectAltName', altNames: [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      { type: 7, ip: '172.25.3.124' },
    ]},
  ]);
  
  // Self-sign
  cert.sign(keys.privateKey, forge.default?.md?.sha256?.create() || forge.md.sha256.create());
  
  const pemCert = pki.certificateToPem(cert);
  const pemKey = pki.privateKeyToPem(keys.privateKey);
  
  writeFileSync(join(dir, 'cert.pem'), pemCert);
  writeFileSync(join(dir, 'key.pem'), pemKey);
  
  console.log('✅ Valid self-signed certificates generated in ./cert/');
}
