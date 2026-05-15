const { initializeApp } = require("firebase/app");
const { getFirestore } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyBevmb_0rKcVDEbAi-E8YYggfXdigVSOR4",
  authDomain: "actionzone-c2819.firebaseapp.com",
  projectId: "actionzone-c2819",
  storageBucket: "actionzone-c2819.firebasestorage.app",
  messagingSenderId: "798064295860",
  appId: "1:798064295860:web:c6f89634232d8be387fce1"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

module.exports = { db };