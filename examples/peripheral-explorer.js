var async = require('async');
const crypto = require('crypto');
var noble = require('../index');

const userKey = new Buffer('9f9d64d7c3d6029e');
console.log(userKey);
const LOCK_STATE = 0x01;
const UNLOCK_STATE = 0x00;
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

          const statChar = services[OTHER_SERVICE]['chars'][STAT]['char'];
          statChar.subscribe((data) => {
            console.log('Notify', data);
          });

          const crypChar = services[OTHER_SERVICE]['chars'][CRYP]['char'];

          crypChar.read((error, data) => {
            const nonce = data;
            console.log("Reading Characterisic CRYP ", nonce);

            const reqIDBytes = new Buffer.alloc(2);
            randFill(reqIDBytes);

            prepareHandshakePayload(reqIDBytes, nonce, (handshake) => {
              console.log("Sending Handshake ", handshake);

              const cmdsChar = services[OTHER_SERVICE]['chars'][CMDS]['char'];

              cmdsChar.write(handshake, false, (err) => {
                const clckChar = services[OTHER_SERVICE]['chars'][CLCK]['char'];

                clckChar.read((error, data) => {
                  console.log(error);
                  console.log(data);

                  if (data[0] == 0x51) {
                    console.log('USER_REQUEST_AUTHENTICATED');

                    crypChar.subscribe((data) => {
                      console.log('CRYP Notify', data);
                    });

                    const interval = setInterval(() => {
                      refreshConnection(cmdsChar, clckChar);
                    }, 1000);

                    crypChar.read((error, data) => {
                      console.log(error);
                      console.log(data);

                      console.log(`Initial State: ${data[1] == LOCK_STATE ? 'LOCKED' : 'UNLOCKED'}`);
                      
                      const initialState = data[1];
                      const newState = initialState ^ 0x01;

                      console.log('Toggling Lock state to:', `${newState == LOCK_STATE ? 'LOCKED' : 'UNLOCKED'}`);

                      prepareLockStateChangePayload(newState, (encPayload) => {
                        console.log('Generated Payload = ', encPayload);

                        cmdsChar.write(encPayload, false, (err) => {
                          console.log(err);
                          clckChar.read((error, data) => {
                            console.log(error);
                            console.log(data);
                            clearInterval(interval);
                            peripheral.disconnect();
                          })
                        });
                      })
                    });
                  } else {
                    console.log('USER_REQUEST_NOT_AUTHENTICATED');
                  }
                });
              });
            });
          });
        }
      );
    });
  });
}

function refreshConnection(inputChar, outputChar) {
  const payload = new Buffer(4);
  payload[0] = 0x60;
  payload[1] = getRandomByte();
  payload[2] = getRandomByte();
  payload[3] = 0;

  const crc = applyCrc16(payload);

  const payloadWithCrc = new Buffer(6);
  payload.forEach((byte, i) => {
    payloadWithCrc[i] = byte;
  });

  payloadWithCrc[4] = (crc >> 8) & 0xFF;
  payloadWithCrc[5] = crc & 0xFF;

  console.log('payloadWithCrc', payloadWithCrc);
  inputChar.write(payloadWithCrc, false, (error) => {
    outputChar.read((error, data) => {
      console.log('status update');
      console.log(error);
      console.log(data);
    })
  }); 
}

function prepareHandshakePayload(reqId, nonce, callback) {
  console.log("PREPARE HANDSHAKE PAYLOAD");
  const hmac = crypto.createHmac('sha1', userKey);
  hmac.on('readable', () => {
    const nonceEnc = hmac.read();
    if (nonceEnc) {
      let handshake = new Buffer(4 + nonceEnc.length);
      handshake[0] = 0x50;
      handshake[1] = reqId[0];
      handshake[2] = reqId[1];
      handshake[3] = nonceEnc.length;
      
      let i = 0;
      while (i < nonceEnc.length) {
        handshake[4 + i] = nonceEnc[i];
        i++;
      }

      const crc = applyCrc16(handshake);

      const payload = new Buffer(4 + nonceEnc.length + 2);

      handshake.forEach((byte, i) => {
        payload[i] = byte;
      });
      payload[handshake.length] = (crc >> 8) & 0xFF;
      payload[handshake.length + 1] = crc & 0xFF;

      callback(payload);
    }
  });

  hmac.write(nonce);
  hmac.end();
}

function prepareLockStateChangePayload(newState, callback) {
  let payload = new Buffer(14);

  for (let i = 0; i < payload.length; ++i) {
    payload[i] = getRandomByte();
  }

  payload[5] = newState;

  const crc = applyCrc16(payload);

  const payloadWithCrc = new Buffer(16);
  payload.forEach((byte, i) => {
    payloadWithCrc[i] = byte;
  });

  payloadWithCrc[14] = (crc >> 8) & 0xFF;
  payloadWithCrc[15] = crc & 0xFF;

  const cipher = crypto.createCipheriv('aes-128-cbc', userKey, Buffer.alloc(16));

  let encPayload = null;
  let obtainedFirstHalf = false;
  cipher.on('readable', () => {
    const data = cipher.read();
    if (data && !obtainedFirstHalf) {
      encPayload = data;
      obtainedFirstHalf = true;
    }
  });

  cipher.on('end', () => {
    const changeLockState = new Buffer(4 + encPayload.length);
    changeLockState[0] = 0x1c;
    changeLockState[1] = getRandomByte();
    changeLockState[2] = getRandomByte();
    changeLockState[3] = encPayload.length;

    let i = 0;
    while (i < encPayload.length) {
      changeLockState[4 + i] = encPayload[i];
      i++;
    }

    const crc = applyCrc16(changeLockState);

    const changeLockStatePayload = new Buffer(changeLockState.length + 2);

    changeLockState.forEach((byte, i) => {
      changeLockStatePayload[i] = byte;
    });
    changeLockStatePayload[changeLockState.length] = (crc >> 8) & 0xFF;
    changeLockStatePayload[changeLockState.length + 1] = crc & 0xFF;


    callback(changeLockStatePayload);
  });

  cipher.write(payloadWithCrc);
  cipher.end();
}


function randFill(buff) {
  for (let i = 0; i < buff.length; ++i) {
    buff[i] = getRandomByte();
  }
}

function getRandomByte() {
  return Math.floor(Math.random() * Math.floor(256));
}

function applyCrc16(bytes) {
    let crc = crc16(0, bytes[0]);
    for (let i = 1; i < bytes.length; i++) {
        crc = crc16(crc, bytes[i]);
    }
    return crc;
}

function crc16(crc, a) {
    crc = ((a & 255) ^ crc) & 65535;
    for (let i = 0; i < 8; i++) {
        if ((crc & 1) == 1) {
            crc = (((crc & 65535) >>> 1) ^ 40961) & 65535;
        } else {
            crc = ((crc & 65535) >>> 1) & 65535;
        }
    }
    return crc;
}
