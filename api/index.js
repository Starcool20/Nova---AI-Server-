import express from 'express';
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, set, onValue, update, ref, child, push, runTransaction, off, remove } from "firebase/database";
import Flutterwave from 'flutterwave-node-v3';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';


const app = express();
let db;
let auth;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const router = express.Router();

const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  // another common pattern
  // res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  )
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  return await fn(req, res)
}

const handler = (req, res) => {
  app(req, res);
}

app.get('/verifyPayment', async (req, res) => {

  const firebaseConfig = {
    apiKey: "AIzaSyAatA-tduzX0gsbd5874si6txHY7Pox940",
    authDomain: "fhenn-shop.firebaseapp.com",
    databaseURL: "https://fhenn-shop-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "fhenn-shop",
    storageBucket: "fhenn-shop.appspot.com",
    messagingSenderId: "230270589568",
    appId: "1:230270589568:web:c176635bf77a7f03fc6465",
    measurementId: "G-FM5HS07XEJ"
  };

  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth();
  db = getDatabase();

  const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);
  const { code, orderIds, status, tx_ref, transaction_id } = req.query;

  if (status !== 'successful') {
    console.log('Not successful');
    return res.sendFile(path.join(__dirname, './html/error.html'));
  }

  let id = code;
  const email = 'fhenndatabase@gmail.com';
  const password = 'Ghjxsrjvdrgjdz532488+@##$$477dghcd85418$()/=!.*+-$$5885';
  const orderId = orderIds;
  const existingID = await getExistingID(id, email, password, transaction_id);
  if (existingID.response !== 'Success') {
    console.log(existingID.errorMsg);
    return res.sendFile(path.join(__dirname, './html/error.html'));
  }

  if (existingID.exists) {
    console.log(existingID.errorMsg);
    return res.sendFile(path.join(__dirname, './html/error.html'));
  }

  flw.Transaction.verify({ id: transaction_id })
    .then(async (response) => {
      console.log(response);
      if (response.data.tx_ref === tx_ref && response.data.status === 'successful' && response.data.currency === 'USD' && processString(response.data.customer.name).firstPart === code) {
        const resss = await processSuccessPaymentTransaction(email, password, id, response.data.amount_settled, response.data.created_at, orderId, response.data.id);

        if (resss.response !== 'Success') {
          console.log('Issues');
          console.log(resss);
          return res.sendFile(path.join(__dirname, './html/error.html'));
        }

        console.log(resss.type + ' went successful');
        return res.sendFile(path.join(__dirname, './html/success.html'));
      } else {
        console.log('Transaction not found ');
        console.log(response);
        return res.sendFile(path.join(__dirname, './html/error.html'));
      }
    })
    .catch((error) => {
      console.log(error);
      return res.sendFile(path.join(__dirname, './html/error.html'));
    });
});

function getExistingID(code, email, password, transaction_id) {
  return new Promise(async (resolve) => {
    const login = await serverLogin(email, password);
    if (login !== 'Success') {
      resolve({ response: 'Error', errorMsg: login, type: '' });
    }

    //const delayServer = await delay();

    const getID = await getIDFn(code, transaction_id);
    if (getID.response !== 'Success') {
      resolve({ response: 'Error', errorMsg: getID.errorMsg, type: '' });
    }

    const checkID = await checkIDFn(transaction_id);
    if (checkID.response !== 'Success') {
      resolve({ response: 'Error', errorMsg: checkID.errorMsg, type: '' });
    }

    resolve({ response: 'Success', exists: checkID.exists });
  });
}

function checkIDFn(id) {
  return new Promise((resolve, reject) => {
    const reference = ref(db, `fhenn-shop-transaction-ids/${id}`);
    onValue(reference, (snapshot) => {
        if (snapshot.exists()) {
          resolve({ response: 'Success', exists: true });
        } else {
          resolve({ response: 'Success', exists: false });
        }
      },
      (error) => {
        resolve({ response: error, errorMsg: error, exists: false });
      });
  });
}

function delay() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve('Success');
    }, 700);
  });
}

function getIDFn(code, transaction_id) {
  return new Promise((resolve) => {
    const reference = ref(db, `fhenn-shop-orders/${code}/nums`);
    onValue(reference, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          if (isFound(data.id, transaction_id)) {
            resolve({ response: 'Success', exists: true });
          } else {
            resolve({ response: 'Success', exists: false });
          }
        } else {
          resolve({ response: 'Success', exists: false });
        }
      },
      (error) => {
        resolve({ response: error, errorMsg: error, exists: false });
      });
  });
}

function processSuccessPaymentTransaction(email, password, code, price, date, orderId, id) {
  return new Promise(async (resolve, reject) => {
    const login = await serverLogin(email, password);
    if (login !== 'Success') {
      resolve({ response: 'Error', errorMsg: login, type: '' });
    }

    const storeID = await storeTransactionId(id);
    if (storeID.response === 'Error') {
      resolve({ response: 'Error', errorMsg: storeID.errorMsg, type: '' });
    }


    const runUpdateTransaction = await runUpdateTransactionFn(code, false, id, date);
    if (runUpdateTransaction.response !== 'Success' || runUpdateTransaction.isFound === true) {
      resolve({ response: 'Error', errorMsg: runUpdateTransaction, type: '' });
    }

    if (runUpdateTransaction.num === 5) {
      const limit = await updateLimit(code);
      if (limit.response !== 'Success') {
        resolve({ response: 'Error', errorMsg: limit.response, type: '' });
      }
    }

    const storeOrder = await storeOrderDB(code, runUpdateTransaction.num, price, date, orderId);
    if (storeOrder.response === 'Error') {
      resolve({ response: 'Error', errorMsg: storeOrder.errorMsg, type: '' });
    }


    resolve({ response: 'Success', type: 'Card Payment', errorMsg: '' });
  });
}

function storeTransactionId(id) {
  return new Promise((resolve, reject) => {
    const reference = ref(db, `fhenn-shop-transaction-ids/${id}`);
    set(reference, {
      isUsed: true
    }).then(() => {
      resolve({ response: 'Success' })
    }).catch((error) => {
      resolve({ response: 'Error', errorMsg: error });
    });

  });
}

function checkLimitFn(code) {
  let stopListener = false
  return new Promise((resolve, reject) => {
    const reference = ref(db, 'fhenn-shop-orders' + '/' + code + '/' + 'nums');
    onValue(reference, (snapshot) => {
        if (stopListener === false) {
          stopListener = true;
          if (snapshot.exists()) {
            const data = snapshot.val();
            const limit = data.limit;
            if (limit === true) {
              resolve({ response: 'Error limit reached' });
            } else {
              resolve({ response: 'Success' });
            }
          } else {
            resolve({ response: 'Error limit does not exist in database' });
          }
        }
      },
      (error) => {
        resolve({ response: error });
      });
  });
}

function updateLimit(code) {
  let stopListener = false;
  return new Promise((resolve, reject) => {
    const reference = ref(db, `fhenn-shop-ids/${code}`);
    runTransaction(reference, (data) => {
        if (stopListener === false) {
          if (data) {
            data.limit = true;
          } else {
            data = {
              hustler: true,
              code: code,
              limit: false
            };
          }
          return data;
        }
        return;
      })
      .then(() => {
        stopListener = true;
        off(reference);
        resolve({ response: 'Success' });
      })
      .catch((error) => {
        stopListener = true;
        off(reference);
        resolve({ response: error, errorMsg: error });
      });
  });
}

function storeOrderDB(code, number, price, dates, orderIds) {
  return new Promise((resolve, reject) => {
    const reference = ref(db, `fhenn-shop-orders/${code}/order${number}`);
    set(reference, {
      amount: price,
      orderId: orderIds,
      date: dates
    }).then(() => {
      resolve({ response: 'Success' })
    }).catch((error) => {
      resolve({ response: 'Error', errorMsg: error });
    });

  });
}

function runUpdateTransactionFn(code, isTransfer, id, dates) {
  let stopListener = false;
  let number = 0;
  let isFoundId = true;

  return new Promise((resolve) => {
    const reference = ref(db, 'fhenn-shop-orders' + '/' + code + '/' + 'nums');
    runTransaction(reference, (data) => {
        if (stopListener === false) {
          if (data) {

            if (data.limit === true) {
              isFoundId = true;
              return;
            }

            if (isFound(data.id, id) === false) {
              data.id = `${data.id} ${id}`;
              isFoundId = false;
            } else {
              isFoundId = true;
              return;
            }

            data.num = (data.num || 0) + 1;
            data.date = dates;
            if (data.num === 5) {
              data.limit = true;
            }
            number = data.num;

          } else {
            data = {
              hustler: true,
              status: '',
              message: '',
              limit: false,
              id: `${id}`,
              date: dates,
              num: 1
            };
            number = 1;
          }
          return data;
        }
        return;
      })
      .then(() => {
        stopListener = true;
        off(reference);
        resolve({ response: 'Success', isFound: isFoundId, num: number });
      })
      .catch((error) => {
        stopListener = true;
        off(reference);
        resolve({ response: error, errorMsg: error });
      });
  });
}

function serverLogin(email, password) {
  return new Promise((resolve) => {
    signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        // Signed in 
        resolve('Success');
      })
      .catch((error) => {
        const errorCode = error.code;
        const errorMessage = error.message;
        resolve(errorMessage);
      });
  });
}

function isFound(str, id) {
  const substrings = str.split(/\s+/);

  for (const substring of substrings) {
    if (substring === id) {
      return true;
    }
  }
  return false;
}

function processString(s) {
  const [firstPart, secondPart] = s.split(' ', 2);
  return { firstPart: firstPart || '', secondPart: secondPart || '' };
}

function generateOrderId(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default allowCors(handler);