/*jshint esversion: 6 */
var Config = require('../config.json');
var selfsigned = require('selfsigned');
var forge = require('node-forge');
var jsonfile = require('jsonfile');
var fs = require('fs');

var DATABOX_DEV = process.env.DATABOX_DEV

var attrs = [{ name: 'commonName', value: 'databox' }];
var config = { days: 365, keySize: 2048, days: 3650, algorithm: 'sha256' };
var rootPems;

const devCertPath = './certs/certs.json';
const devCAPath = './certs/containerManager.crt';

//Generate the CM root cert at startup.
//If in DEV mode we need to use the same certs at restart because the docker demon has to trust the container manger CA to verify 
//the local registry. If we are not in dev mode then the certs are generated at each restart of the container manger.
var init = function() {
    return new Promise( (resolve, reject) =>  {

        
        jsonfile.readFile(devCertPath, function (err, obj) {
            
            //return cached certs if we have them and are in DEV mode
            if(err === null && DATABOX_DEV) {
                rootPems = obj;
                resolve({rootCAcert:rootPems.cert});
                return;
            }

            selfsigned.generate(attrs, config, function (err, pems) {
                if(err) {
                    reject(err);
                }
                rootPems = pems;
                
                //Cash the certs in dev mode. These are new certs so display the update instructions and exit.
                if(DATABOX_DEV) {
                    jsonfile.writeFileSync(devCertPath, rootPems);
                    fs.writeFileSync(devCAPath, rootPems.cert);             

                    reject( 
                        "\n###################### INSTALL INSTRUCTIONS ######################\n" +
                        "\n"+
                        "\n"+
                        " You will need to add the container manager CA to the docker keychain \n"+
                        "\n"+
                        " \t Ubuntu: sudo install -m 044 -D "+devCAPath+" /etc/docker/certs.d/"+Config.registryUrl_dev+"/ca.crt \n"+
                        " \t MAC OSX: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "+devCAPath+" \n"+
                        "\n"+
                        "Then restart docker:\n"+
                        "\n \t Ubuntu: sudo service docker restart \n"+
                        "\n \t MAC OSX:: use the gui! \n"+
                        "Then restart the container manager:\n"+
                        "\n \t ./platformDevMode.sh \n"+
                        "Then seed the local docker registry with the demo images:\n"+
                        "\n \t sh ./updateLocalRegistry.sh \n"+
                        "Then restart the container manager again:\n"+
                        "\n \t ./platformDevMode.sh \n"+
                        "\n#################### END INSTALL INSTRUCTIONS #####################\n"
                    );
                }

                resolve({rootCAcert:rootPems.cert});
            });
        });
            
    });
};

var getRootCert =  function () {
    return rootPems.cert;
};

//based on code extracted from the selfsigned module Licence MIT 
var createClientCert =  function (commonName) {
    
    function toPositiveHex(hexString){
    var mostSiginficativeHexAsInt = parseInt(hexString[0], 16);
    if (mostSiginficativeHexAsInt < 8){
        return hexString;
    }

    mostSiginficativeHexAsInt -= 8;
    return mostSiginficativeHexAsInt.toString() + hexString.substring(1);
    }
    
    return new Promise( (resolve, reject) =>  {

    var pki = forge.pki;
    pem = {};

    var clientkeys = forge.pki.rsa.generateKeyPair(2048);
    var clientcert = forge.pki.createCertificate();
    clientcert.serialNumber = toPositiveHex(forge.util.bytesToHex(forge.random.getBytesSync(9)));
    clientcert.validity.notBefore = new Date();
    clientcert.validity.notAfter = new Date();
    clientcert.validity.notAfter.setFullYear(clientcert.validity.notBefore.getFullYear() + 10);

    var clientAttrs = [{ name: 'commonName', value: commonName }];

    clientcert.setSubject(clientAttrs);
    // Set the issuer to the parent key
    clientcert.setIssuer(attrs);

    clientcert.setExtensions([{
        name: 'basicConstraints',
        cA: true
    }, {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
    }, {
        name: 'subjectAltName',
        altNames: [
            {
                type: 2, // DNS name
                value: commonName
            },
            {
                type: 2, // DNS name
                value: 'localhost'
            }
        ]
    }]);

    clientcert.publicKey = clientkeys.publicKey;

    // Sign client cert with root cert
    try {
        rootPrivateKey = pki.privateKeyFromPem(rootPems.private);
        clientcert.sign(rootPrivateKey);
    } catch (e) {
        reject("ERROR",e);
    }
    pem.clientprivate = forge.pki.privateKeyToPem(clientkeys.privateKey);
    pem.clientpublic = forge.pki.publicKeyToPem(clientkeys.publicKey);
    pem.clientcert = forge.pki.certificateToPem(clientcert);

    resolve(pem);
    });
};

module.exports = {init:init, createClientCert:createClientCert, getRootCert:getRootCert};
