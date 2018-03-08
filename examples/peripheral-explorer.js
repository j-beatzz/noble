var async = require('async');
const crypto = require('crypto');
var noble = require('../index');
const crc16 = require('crc16');

const userKey = new Buffer('67e5660ed9df45c4b0e8c13a8656d003');
const deviceID = '';
const CLCK = "1a53e10758f747e5a919acc9e05a908b";
const STAT = "c2bea3d2ae334e9fabeee05377f8623f";
const CRYP = "26397326157c4364acade7441b43e3fc";
const CMDS = "562e4701c08e4547a7b0908823260df3";
const EncPipeWrite = "0d08daed99f748c5ab62ee2ec52d48b8";
const EncPipeRead = "0d08dead99f748c5ab62ee2ec52d48b8";
const EncPipeWriteNonce = "0d08daef99f748c5ab62ee2ec52d48b8";
const EncPipeReadNonce = "0d08deaf99f748c5ab62ee2ec52d48b8";

const ENC_SERVICE = "0d08ecec99f748c5ab62ee2ec52d48b8";
const OTHER_SERVICE = "a1a51a187b7747d291db34a48dcd3de9";

const services = {};

noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    noble.startScanning();
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', function(peripheral) {
  if (peripheral.advertisement.localName === '12d39e60') {
    noble.stopScanning();

    console.log('peripheral with ID ' + peripheral.id + ' found');
    var advertisement = peripheral.advertisement;

    var localName = advertisement.localName;
    var txPowerLevel = advertisement.txPowerLevel;
    var manufacturerData = advertisement.manufacturerData;
    var serviceData = advertisement.serviceData;
    var serviceUuids = advertisement.serviceUuids;

    if (localName) {
      console.log('  Local Name        = ' + localName);
    }

    if (txPowerLevel) {
      console.log('  TX Power Level    = ' + txPowerLevel);
    }

    if (manufacturerData) {
      console.log('  Manufacturer Data = ' + manufacturerData.toString('hex'));
    }

    if (serviceData) {
      console.log('  Service Data      = ' + JSON.stringify(serviceData, null, 2));
    }

    if (serviceUuids) {
      console.log('  Service UUIDs     = ' + serviceUuids);
    }

    console.log();

    explore(peripheral);
  }
});

function explore(peripheral) {
  console.log('services and characteristics:');

  peripheral.on('disconnect', function() {
    process.exit(0);
  });

  peripheral.connect(function(error) {
    peripheral.discoverServices([], function(error, services) {
      console.log("===== getting services =====");
      var serviceIndex = 0;

      async.whilst(
        function () {
          return (serviceIndex < services.length);
        },
        function(callback) {
          var service = services[serviceIndex];
          var serviceInfo = service.uuid;

          if (service.name) {
            serviceInfo += ' (' + service.name + ')';
          }

          services[serviceInfo] = {
            'name': service.name || '',
            'service': service,
            'chars': {}
          };

          service.discoverCharacteristics([], function(error, characteristics) {
            var characteristicIndex = 0;

            async.whilst(
              function () {
                return (characteristicIndex < characteristics.length);
              },
              function(callback) {
                var characteristic = characteristics[characteristicIndex];
                var characteristicInfo = '  ' + characteristic.uuid;

                if (characteristic.name) {
                  characteristicInfo += ' (' + characteristic.name + ')';
                }

                let name = '';
                if (serviceInfo === "a1a51a187b7747d291db34a48dcd3de9") { 
                  if (characteristic.uuid === CLCK) {
                    name = 'CLCK';
                  } else if (characteristic.uuid === STAT) {
                    name = 'STAT';
                  } else if (characteristic.uuid === CRYP) {
                    name = 'CRYP';
                  } else if (characteristic.uuid === CMDS) {
                    name = 'CMDS';
                  }
                } else if (serviceInfo === '0d08ecec99f748c5ab62ee2ec52d48b8') {
                  if (characteristic.uuid === EncPipeRead) {
                    name = 'EncPipeRead';
                  } else if (characteristic.uuid === EncPipeWrite) {
                    name = 'EncPipeWrite';
                  } else if (characteristic.uuid === EncPipeReadNonce) {
                    name = 'EncPipeReadNonce';
                  } else if (characteristic.uuid === EncPipeWriteNonce) {
                    name = 'EncPipeWriteNonce';
                  }
                }


                services[serviceInfo]['chars'][characteristic.uuid] = {
                  'name': name,
                  'char': characteristic,
                  'descriptors': {
                    '2901': null,
                    '2902': null,
                  }
                };

                async.series([
                  function(callback) {
                    characteristic.discoverDescriptors(function(error, descriptors) {
                      descriptors.forEach((descriptor) => {
                        services[serviceInfo]['chars'][characteristic.uuid]['descriptors'][descriptor.uuid] = descriptor;
                      });
                    });

                    callback();
                  },
                  function() {
                    console.log(characteristicInfo);
                    characteristicIndex++;
                    callback();
                  }
                ]);


              },
              function(error) {
                serviceIndex++;
                callback();
              }
            );
          });
        },
        function (err) {
          console.log('============  done  =============');

          const crypChar = services[OTHER_SERVICE]['chars'][CRYP]['char'];

          crypChar.read((error, data) => {
            const nonce = data;
            console.log("Reading Characterisic CRYP ", nonce);

            const reqIDBytes = new Buffer.alloc(2);
            randFill(reqIDBytes);

            prepareHandshakePayload(reqIDBytes, nonce, (handshake) => {
              console.log("Sending Handshake ", handshake);

              const cmdsChar = services[OTHER_SERVICE]['chars'][CMDS]['char'];

              cmdsChar.write(handshake, false, (data) => {

                const clckChar = services[OTHER_SERVICE]['chars'][CLCK]['char'];

                clckChar.read((error, data) => {
                  console.log(error);
                  console.log(data);

                  peripheral.disconnect();
                });
              });
            });
          })
        }
      );
    });
  });
}

function prepareHandshakePayload(reqId, nonce, callback) {
  console.log("PREPARE HANDSHAKE PAYLOAD");
  const hmac = crypto.createHmac('sha1', userKey);
  hmac.on('readable', () => {
    const userKeyHMAC = hmac.read();
    if (userKeyHMAC) {
      let handshake = Buffer.alloc(4);
      handshake[0] = 0x50;
      handshake[1] = reqId[0];
      handshake[2] = reqId[1];

      handshake[3] = userKeyHMAC.length;

      console.log(userKeyHMAC.toString('hex'), userKeyHMAC.length);
      handshake = Buffer.concat([handshake, userKeyHMAC], handshake.length + userKeyHMAC.length);

      const crc = crcBuf(handshake);
      console.log(crc);
      handshake = Buffer.concat([handshake, crc], handshake.length + crc.length);
      callback(handshake);
    }
  });

  hmac.write(nonce.toString());
  hmac.end();
}

/*
if (characteristic.uuid === CRYPT) {
                            console.log("NONCE ++++ ", data);
                            const nonce = data;
                            

                            console.log(reqIDBytes);

                          } else {
                            callback();
                          }
*/



function crcBuf(dataBuf) {
  const crc = crc16(dataBuf);
  const buf = new Buffer(2);
  buf.writeUInt16BE(crc);

  return buf;
}

function randFill(buff) {
  for (let i = 0; i < buff.length; ++i) {
    // buff[i] = getRandomByte();
    buff[i] = 0x00;
  }
}

function getRandomByte() {
  return Math.floor(Math.random() * Math.floor(256));
}
