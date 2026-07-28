import { db } from './firebase-config.js';
import { doc, getDoc, collection, getDocs, setDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Các biến toàn cục lưu trạng thái
let currentCandidate = null;
let testConfig = null;
let activeTestId = null;
let questionDataList = []; 
let countdownInterval = null;

// Thuật toán xáo trộn Fisher-Yates
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ==========================================
// 1. LOGIC ĐĂNG NHẬP VÀ XÁC THỰC
// ==========================================
document.getElementById('btnLogin').addEventListener('click', async () => {
    const cccd = document.getElementById('cccdInput').value.trim();
    const msg = document.getElementById('loginMessage');
    
    if (!cccd) { msg.innerText = "Vui lòng nhập CCCD!"; return; }
    msg.style.color = "blue"; msg.innerText = "Đang kiểm tra hệ thống...";

    try {
        // Bước A: Tìm xem bài thi nào đang được Admin kích hoạt
        const activeTestSnap = await getDoc(doc(db, "System", "ActiveTest"));
        if (!activeTestSnap.exists()) {
            msg.style.color = "red"; msg.innerText = "Hệ thống hiện chưa có bài thi nào được mở!"; return;
        }
        activeTestId = activeTestSnap.data().activeTestId;

        // Bước B: Lấy cấu hình của bài thi đang kích hoạt
        const configSnap = await getDoc(doc(db, "TestConfig", activeTestId));
        if (!configSnap.exists()) {
            msg.style.color = "red"; msg.innerText = "Cấu hình bài thi bị lỗi!"; return;
        }
        testConfig = configSnap.data();

        // Bước C: Kiểm tra thời gian mở/đóng bài thi
        const now = new Date();
        const startTime = new Date(testConfig.startTime);
        const endTime = new Date(testConfig.endTime);

        if (now < startTime) {
            msg.style.color = "red"; msg.innerText = `Kỳ thi chưa bắt đầu. Thời gian mở: ${startTime.toLocaleString('vi-VN')}`; return;
        }
        if (now > endTime) {
            msg.style.color = "red"; msg.innerText = "Kỳ thi đã kết thúc!"; return;
        }

        // Bước D: Kiểm tra CCCD của thí sinh (ID giờ là: testId_CCCD)
        const candidateRef = doc(db, "Candidates", `${activeTestId}_${cccd}`);
        const docSnap = await getDoc(candidateRef);

        if (docSnap.exists()) {
            currentCandidate = docSnap.data();
            
            // Chuyển sang màn hình xác nhận
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('infoSection').classList.remove('hidden');
            
            document.getElementById('infoName').innerText = currentCandidate.fullName;
            document.getElementById('infoDob').innerText = currentCandidate.dob || "Không có";
            document.getElementById('infoTitle').innerText = currentCandidate.title || "Không có";
        } else {
            msg.style.color = "red"; msg.innerText = "Bạn không có tên trong danh sách của bài thi này!";
        }
    } catch (error) {
        console.error(error);
        msg.style.color = "red"; msg.innerText = "Lỗi kết nối máy chủ!";
    }
});

// ==========================================
// 2. TẢI ĐỀ THI, XÁO TRỘN THEO TỪNG SECTION
// ==========================================
document.getElementById('btnStartExam').addEventListener('click', async () => {
    document.getElementById('infoSection').classList.add('hidden');
    document.getElementById('examSection').classList.remove('hidden');
    document.getElementById('examTitle').innerText = testConfig.title;

    // Truy vấn CHỈ lấy các câu hỏi thuộc về bài thi đang mở
    const qQuery = query(collection(db, "QuestionBank"), where("testId", "==", activeTestId));
    const qSnapshot = await getDocs(qQuery);
    
    // Nhóm câu hỏi theo từng SectionId
    const questionsBySection = {};
    qSnapshot.forEach((doc) => {
        const q = { id: doc.id, ...doc.data() };
        if (!questionsBySection[q.sectionId]) questionsBySection[q.sectionId] = [];
        questionsBySection[q.sectionId].push(q);
    });

    const container = document.getElementById('questionsContainer');
    container.innerHTML = "";
    let globalQuestionIndex = 0; // Đếm số thứ tự câu hỏi xuyên suốt các section

    // Duyệt qua cấu hình từng Section mà Admin đã cài đặt
    testConfig.sections.forEach((secConfig, secIndex) => {
        const secId = secConfig.sectionId;
        let secQuestions = questionsBySection[secId] || [];
        
        // Xáo trộn và cắt đúng số lượng câu hỏi Admin yêu cầu cho section này
        secQuestions = shuffleArray(secQuestions).slice(0, secConfig.numQuestions);
        
        if (secQuestions.length > 0) {
            // In tiêu đề Section phân cách
            container.innerHTML += `<h3 style="margin-top:20px; color:#007bff; border-bottom: 2px solid #007bff; padding-bottom: 5px;">Phần ${secIndex + 1} (${secConfig.pointsPerQuestion} điểm/câu)</h3>`;
        }

        // Đổ câu hỏi ra HTML
        secQuestions.forEach((q) => {
            globalQuestionIndex++;
            let answers = [...q.wrongAnswers, q.correctAnswer];
            answers = shuffleArray(answers); // Xáo trộn đáp án A B C D

            // Lưu dữ liệu vào mảng để chấm điểm (Lưu thêm trọng số điểm của từng câu)
            questionDataList.push({
                id: q.id,
                questionText: q.questionText,
                correctAnswer: q.correctAnswer,
                points: secConfig.pointsPerQuestion 
            });

            let html = `<div class="question-block" id="qblock_${globalQuestionIndex - 1}">
                <p><strong>Câu ${globalQuestionIndex}:</strong> ${q.questionText}</p>`;
            
            answers.forEach((ans) => {
                html += `<label class="answer-label">
                    <input type="radio" name="q_${globalQuestionIndex - 1}" value="${ans}"> ${ans}
                </label>`;
            });
            html += `</div>`;
            container.innerHTML += html;
        });
    });

    // Bắt đầu đếm ngược
    startTimer(testConfig.duration * 60);
});

// ==========================================
// 3. ĐỒNG HỒ ĐẾM NGƯỢC
// ==========================================
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

// ==========================================
// 4. CHẤM ĐIỂM & NỘP BÀI LÊN FIREBASE
// ==========================================
document.getElementById('btnSubmitExam').addEventListener('click', () => {
    const unanswered = questionDataList.findIndex((q, i) => !document.querySelector(`input[name="q_${i}"]:checked`));
    if (unanswered !== -1) {
        if (!confirm(`Bạn chưa trả lời Câu ${unanswered + 1}. Bạn có chắc chắn muốn nộp bài không?`)) return;
    } else {
        if (!confirm("Bạn xác nhận muốn nộp bài?")) return;
    }
    submitExam();
});

async function submitExam() {
    clearInterval(countdownInterval); 
    
    let totalScore = 0;
    let maxScore = 0; // Tính điểm tối đa có thể đạt
    const userAnswers = {};

    questionDataList.forEach((q, index) => {
        maxScore += q.points;
        const selected = document.querySelector(`input[name="q_${index}"]:checked`);
        const userChoice = selected ? selected.value : null;
        userAnswers[`Câu ${index + 1}`] = userChoice;

        if (userChoice === q.correctAnswer) {
            totalScore += q.points; // Cộng điểm dựa trên cấu hình của Section
        }
    });

    const isPassed = totalScore >= testConfig.passScore;
    
    document.getElementById('examSection').classList.add('hidden');
    document.getElementById('resultSection').classList.remove('hidden');
    
    const resMsg = document.getElementById('resultMessage');
    document.getElementById('scoreDisplay').innerText = `Điểm của bạn: ${totalScore} / ${maxScore}`;
    
    if (isPassed) {
        resMsg.style.color = "green";
        resMsg.innerText = `Chúc mừng! Bạn đã ĐẠT bài thi (Điểm chuẩn: ${testConfig.passScore})`;
    } else {
        resMsg.style.color = "red";
        resMsg.innerText = `Rất tiếc! Bạn CHƯA ĐẠT bài thi (Điểm chuẩn: ${testConfig.passScore})`;
    }

    try {
        // ID bản ghi: testId_CCCD để một thí sinh có thể làm nhiều bài thi khác nhau mà không bị ghi đè
        const submissionRef = doc(db, "Submissions", `${activeTestId}_${currentCandidate.cccd}`);
        await setDoc(submissionRef, {
            testId: activeTestId, // Cực kỳ quan trọng để Admin lọc thống kê
            fullName: currentCandidate.fullName,
            cccd: currentCandidate.cccd,
            score: totalScore,
            isPassed: isPassed,
            answers: userAnswers,
            submittedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error("Lỗi lưu kết quả:", err);
        alert("Lỗi mạng! Điểm đã được tính nhưng không thể lưu lên máy chủ.");
    }
}
