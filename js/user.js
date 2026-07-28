import { db } from './firebase-config.js';
import { doc, getDoc, collection, getDocs, setDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let currentCandidate = null;
let testConfig = null;
let activeTestId = null;
let questionDataList = []; 
let countdownInterval = null;
let availableTests = {}; 

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 1. TẢI VÀ TỰ ĐỘNG CHỌN BÀI THI ĐANG MỞ
window.onload = async () => {
    const selectBox = document.getElementById('testSelect');
    try {
        const snapshot = await getDocs(collection(db, "TestConfig"));
        selectBox.innerHTML = '<option value="">-- Chọn bài thi bạn muốn làm --</option>';
        
        const now = new Date();
        let firstOpenTestId = null; // Lưu ID bài thi mở đầu tiên tìm thấy
        let hasOpenTest = false;

        snapshot.forEach(docSnap => {
            if (docSnap.id !== "current_test") { 
                const data = docSnap.data();
                if(data.endTime) {
                    const endTime = new Date(data.endTime);
                    // Sửa lỗi Parse Time: Đảm bảo thời gian hiện tại <= thời gian đóng
                    if (now.getTime() <= endTime.getTime()) {
                        availableTests[data.testId] = data;
                        const option = document.createElement('option');
                        option.value = data.testId;
                        option.textContent = data.title;
                        selectBox.appendChild(option);
                        
                        if(!firstOpenTestId) firstOpenTestId = data.testId;
                        hasOpenTest = true;
                    }
                }
            }
        });

        if (!hasOpenTest) {
            selectBox.innerHTML = '<option value="">-- Hiện không có bài thi nào đang mở --</option>';
        } else {
            // TỰ ĐỘNG CHỌN SẴN BÀI THI TRÊN DROPDOWN
            selectBox.value = firstOpenTestId;
        }
    } catch (error) {
        console.error("Lỗi tải danh sách:", error);
        selectBox.innerHTML = '<option value="">-- Lỗi tải dữ liệu. Hãy tải lại trang (F5) --</option>';
    }
};

// 2. ĐĂNG NHẬP
document.getElementById('btnLogin').addEventListener('click', async () => {
    const testId = document.getElementById('testSelect').value;
    const cccd = document.getElementById('cccdInput').value.trim();
    const msg = document.getElementById('loginMessage');
    
    if (!testId) { msg.innerText = "Vui lòng chọn một bài thi!"; return; }
    if (!cccd) { msg.innerText = "Vui lòng nhập số CCCD!"; return; }
    
    msg.style.color = "blue"; msg.innerText = "Đang kiểm tra hệ thống...";

    try {
        testConfig = availableTests[testId];
        activeTestId = testId;

        const now = new Date();
        const startTime = new Date(testConfig.startTime);
        if (now.getTime() < startTime.getTime()) {
            msg.style.color = "red"; 
            msg.innerText = `Kỳ thi này chưa bắt đầu. Thời gian mở: ${startTime.toLocaleString('vi-VN')}`; 
            return;
        }

        const candidateRef = doc(db, "Candidates", `${activeTestId}_${cccd}`);
        const docSnap = await getDoc(candidateRef);

        if (docSnap.exists()) {
            currentCandidate = docSnap.data();
            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('infoSection').classList.remove('hidden');
            
            document.getElementById('infoTestTitle').innerText = testConfig.title;
            document.getElementById('infoName').innerText = currentCandidate.fullName;
            document.getElementById('infoDob').innerText = currentCandidate.dob || "Không có";
            document.getElementById('infoTitle').innerText = currentCandidate.title || "Không có";
            document.getElementById('infoCccd').innerText = currentCandidate.cccd;
        } else {
            msg.style.color = "red"; msg.innerText = "CCCD không tồn tại trong danh sách của bài thi này!";
        }
    } catch (error) {
        console.error(error);
        msg.style.color = "red"; msg.innerText = "Lỗi kết nối máy chủ!";
    }
});

// 3. TẢI ĐỀ THI & BẮT ĐẦU
document.getElementById('btnStartExam').addEventListener('click', async () => {
    document.getElementById('infoSection').classList.add('hidden');
    document.getElementById('examSection').classList.remove('hidden');
    document.getElementById('examTitle').innerText = testConfig.title;

    const qQuery = query(collection(db, "QuestionBank"), where("testId", "==", activeTestId));
    const qSnapshot = await getDocs(qQuery);
    
    const questionsBySection = {};
    qSnapshot.forEach((docSnap) => {
        const q = { id: docSnap.id, ...docSnap.data() };
        if (!questionsBySection[q.sectionId]) questionsBySection[q.sectionId] = [];
        questionsBySection[q.sectionId].push(q);
    });

    const container = document.getElementById('questionsContainer');
    container.innerHTML = "";
    let globalQuestionIndex = 0; 

    testConfig.sections.forEach((secConfig, secIndex) => {
        const secId = secConfig.sectionId;
        let secQuestions = questionsBySection[secId] || [];
        secQuestions = shuffleArray(secQuestions).slice(0, secConfig.numQuestions);
        
        if (secQuestions.length > 0) {
            container.innerHTML += `<h3 style="margin-top:25px; color:#333; background: #e9ecef; padding: 10px; border-radius: 4px;">Phần ${secIndex + 1} (${secConfig.pointsPerQuestion} điểm/câu)</h3>`;
        }

        secQuestions.forEach((q) => {
            globalQuestionIndex++;
            let answers = [...q.wrongAnswers, q.correctAnswer];
            answers = shuffleArray(answers);

            questionDataList.push({
                id: q.id, questionText: q.questionText, correctAnswer: q.correctAnswer, points: secConfig.pointsPerQuestion 
            });

            let html = `<div class="question-block" id="qblock_${globalQuestionIndex - 1}">
                <p style="font-size: 16px; margin-bottom: 15px;"><strong>Câu ${globalQuestionIndex}:</strong> ${q.questionText}</p>`;
            answers.forEach((ans) => {
                html += `<label class="answer-label"><input type="radio" name="q_${globalQuestionIndex - 1}" value="${ans}"> ${ans}</label>`;
            });
            html += `</div>`;
            container.innerHTML += html;
        });
    });
    startTimer(testConfig.duration * 60);
});

// 4. ĐẾM NGƯỢC
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

// 5. NỘP BÀI
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
    let totalScore = 0; let maxScore = 0; const userAnswers = {};

    questionDataList.forEach((q, index) => {
        maxScore += q.points;
        const selected = document.querySelector(`input[name="q_${index}"]:checked`);
        const userChoice = selected ? selected.value : null;
        userAnswers[`Câu ${index + 1}`] = userChoice;
        if (userChoice === q.correctAnswer) totalScore += q.points; 
    });

    const isPassed = totalScore >= testConfig.passScore;
    document.getElementById('examSection').classList.add('hidden');
    document.getElementById('resultSection').classList.remove('hidden');
    
    const resMsg = document.getElementById('resultMessage');
    document.getElementById('scoreDisplay').innerText = `${totalScore} / ${maxScore}`;
    
    if (isPassed) {
        resMsg.style.color = "green"; resMsg.innerText = `Chúc mừng! Bạn đã ĐẠT (Điểm chuẩn: ${testConfig.passScore})`;
    } else {
        resMsg.style.color = "red"; resMsg.innerText = `Rất tiếc! Bạn CHƯA ĐẠT (Điểm chuẩn: ${testConfig.passScore})`;
    }

    try {
        const submissionRef = doc(db, "Submissions", `${activeTestId}_${currentCandidate.cccd}`);
        await setDoc(submissionRef, {
            testId: activeTestId, fullName: currentCandidate.fullName, cccd: currentCandidate.cccd,
            score: totalScore, isPassed: isPassed, answers: userAnswers, submittedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error(err); alert("Lỗi mạng! Điểm đã được tính nhưng không thể lưu lên máy chủ.");
    }
}
