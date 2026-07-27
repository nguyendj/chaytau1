// Import các hàm kết nối Firebase từ CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA3I8Wx7WbSo1X04rXTASX_VrAg2Z8KlCQ",
  authDomain: "chaytau1.firebaseapp.com",
  projectId: "chaytau1",
  storageBucket: "chaytau1.firebasestorage.app",
  messagingSenderId: "1072258410362",
  appId: "1:1072258410362:web:cdfd4bb314300191b058c3",
  measurementId: "G-P4JJ000X73"
};
// Khởi tạo ứng dụng Firebase và Firestore Database
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
