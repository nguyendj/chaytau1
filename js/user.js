import { db } from './firebase-config.js';
import { doc, getDoc, collection, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Các biến toàn cục lưu trạng thái thi
let currentCandidate = null;
let testConfig = null;
let questionDataList = []; 
let countdownInterval = null;

// Thuật toán xáo trộn ngẫu nhiên Fisher-Yates
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 1. Logic Đăng Nhập
document.getElementById('btnLogin').addEventListener('click', async () => {
    const cccd = document.getElementById('cccdInput').value.trim();
    const msg = document.getElementById('loginMessage');
    
    if (!cccd) {
        msg.innerText = "Vui lòng nhập CCCD!"; return;
    }
    msg.style.color = "blue";
    msg.innerText = "Đang kiểm tra dữ liệu...";

    try {
        // Lấy thông tin cấu hình bài thi để kiểm tra thời gian mở/đóng
        const configSnap = await getDoc(doc(db, "TestConfig", "current_test"));
        if (!configSnap.exists()) {
            msg.style.color = "red"; msg.innerText = "Chưa có cấu hình bài thi từ Admin!"; return;
        }
        testConfig = configSnap.data();
        
        const now = new Date();
        const startTime = new Date(testConfig.startTime);
        const endTime = new Date(testConfig.endTime);

        if (now < startTime) {
            msg.style.color = "red"; msg.innerText = `Kỳ thi chưa bắt đầu. Thời gian mở: ${testConfig.startTime}`; return;
        }
        if (now > endTime) {
            msg.style.color = "red"; msg.innerText = "Kỳ thi đã kết thúc!"; return;
        }

        // Kiểm tra CCCD trong Database
        const docRef = doc(db, "Candidates", cccd);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            currentCandidate = docSnap.data();
            
            // Chuyển giao diện sang phần Xác nhận thông tin
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('infoSection').classList.remove('hidden');
            
            document.getElementById('infoName').innerText = currentCandidate.fullName;
            document.getElementById('infoDob').innerText = currentCandidate.dob;
            document.getElementById('infoTitle').innerText = currentCandidate.title;
        } else {
            msg.style.color = "red"; msg.innerText = "Không tìm thấy thí sinh với CCCD này!";
        }
    } catch (error) {
        console.error(error);
        msg.style.color = "red"; msg.innerText = "Lỗi kết nối máy chủ!";
    }
});

// 2. Logic Bắt Đầu Làm Bài
document.getElementById('btnStartExam').addEventListener('click', async () => {
    document.getElementById('infoSection').classList.add('hidden');
    document.getElementById('examSection').classList.remove('hidden');
    document.getElementById('examTitle').innerText = testConfig.title;

    // Lấy ngân hàng câu hỏi
    const qSnapshot = await getDocs(collection(db, "QuestionBank"));
    let allQuestions = [];
    qSnapshot.forEach((doc) => {
        allQuestions.push({ id: doc.id, ...doc.data() });
    });

    // Lấy số lượng câu hỏi ngẫu nhiên dựa trên cấu hình (số section * số câu mỗi section)
    const totalQuestionsNeeded = testConfig.numSections * testConfig.questionsPerSection;
    allQuestions = shuffleArray(allQuestions);
    const selectedQuestions = allQuestions.slice(0, totalQuestionsNeeded);

    const container = document.getElementById('questionsContainer');
    container.innerHTML = "";

    // Render câu hỏi ra màn hình
    selectedQuestions.forEach((q, index) => {
        // Gộp đáp án đúng và sai, sau đó xáo trộn vị trí hiển thị
        let answers = [...q.wrongAnswers, q.correctAnswer];
        answers = shuffleArray(answers);

        // Lưu dữ liệu vào mảng global để dùng khi chấm điểm (không đưa đáp án đúng vào HTML)
        questionDataList.push({
            id: q.id,
            questionText: q.questionText,
            correctAnswer: q.correctAnswer,
            points: testConfig.pointsPerQuestion
        });

        // Tạo HTML
        let html = `<div class="question-block" id="qblock_${index}">
            <p><strong>Câu ${index + 1}:</strong> ${q.questionText}</p>`;
        
        answers.forEach((ans, aIndex) => {
            html += `<label class="answer-label">
                <input type="radio" name="q_${index}" value="${ans}"> ${ans}
            </label>`;
        });
        html += `</div>`;
        container.innerHTML += html;
    });

    // Bắt đầu đếm ngược thời gian
    startTimer(testConfig.duration * 60);
});

// 3. Logic Đồng hồ đếm ngược
function startTimer(durationInSeconds) {
    let timer = durationInSeconds;
    const display = document.getElementById('timerDisplay');
    
    countdownInterval = setInterval(() => {
        let minutes = parseInt(timer / 60, 10);
        let seconds = parseInt(timer % 60, 10);

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        display.textContent = `Thời gian còn lại: ${minutes}:${seconds}`;

        if (--timer < 0) {
            clearInterval(countdownInterval);
            alert("Đã hết thời gian làm bài! Hệ thống tự động nộp bài.");
            submitExam();
        }
    }, 1000);
}

// 4. Logic Nộp bài và Lưu kết quả
document.getElementById('btnSubmitExam').addEventListener('click', () => {
    // Kiểm tra xem đã trả lời hết chưa
    const unanswered = questionDataList.findIndex((q, i) => !document.querySelector(`input[name="q_${i}"]:checked`));
    if (unanswered !== -1) {
        if (!confirm(`Bạn chưa trả lời Câu ${unanswered + 1}. Bạn có chắc chắn muốn nộp bài không?`)) {
            return;
        }
    } else {
        if (!confirm("Bạn xác nhận muốn nộp bài?")) return;
    }
    submitExam();
});

async function submitExam() {
    clearInterval(countdownInterval); // Dừng đồng hồ
    
    let totalScore = 0;
    const userAnswers = {};

    // Chấm điểm
    questionDataList.forEach((q, index) => {
        const selected = document.querySelector(`input[name="q_${index}"]:checked`);
        const userChoice = selected ? selected.value : null;
        userAnswers[`Câu ${index + 1}`] = userChoice;

        if (userChoice === q.correctAnswer) {
            totalScore += q.points;
        }
    });

    // Tính toán kết quả đạt / không đạt
    const isPassed = totalScore >= testConfig.passScore;
    
    document.getElementById('examSection').classList.add('hidden');
    document.getElementById('resultSection').classList.remove('hidden');
    
    const resMsg = document.getElementById('resultMessage');
    document.getElementById('scoreDisplay').innerText = `Điểm của bạn: ${totalScore} / ${questionDataList.length * testConfig.pointsPerQuestion}`;
    
    if (isPassed) {
        resMsg.style.color = "green";
        resMsg.innerText = `Chúc mừng! Bạn đã ĐẠT bài thi (Điểm chuẩn: ${testConfig.passScore})`;
    } else {
        resMsg.style.color = "red";
        resMsg.innerText = `Rất tiếc! Bạn CHƯA ĐẠT bài thi (Điểm chuẩn: ${testConfig.passScore})`;
    }

    // Đẩy kết quả lên Firestore collection 'Submissions'
    try {
        const submissionRef = doc(db, "Submissions", currentCandidate.cccd);
        await setDoc(submissionRef, {
            fullName: currentCandidate.fullName,
            cccd: currentCandidate.cccd,
            title: currentCandidate.title,
            score: totalScore,
            isPassed: isPassed,
            answers: userAnswers,
            submittedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error("Lỗi lưu kết quả:", err);
        alert("Lỗi mạng! Không thể lưu bài lên hệ thống.");
    }
}
