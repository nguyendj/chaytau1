import { db } from './firebase-config.js';
import { doc, setDoc, writeBatch, collection } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Hàm hỗ trợ đọc file Excel trả về mảng 2 chiều
function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            // Lấy dữ liệu dạng mảng các dòng (bỏ qua dòng tiêu đề)
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            resolve(jsonData.slice(1)); // Cắt bỏ dòng 0 (Header của Excel)
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

document.getElementById('btnSaveData').addEventListener('click', async () => {
    const statusEl = document.getElementById('statusMessage');
    statusEl.style.color = "blue";
    statusEl.innerText = "Đang xử lý dữ liệu, vui lòng chờ...";

    try {
        const fileQuestions = document.getElementById('fileQuestions').files[0];
        const fileCandidates = document.getElementById('fileCandidates').files[0];

        if (!fileQuestions || !fileCandidates) {
            alert("Vui lòng upload đầy đủ cả 2 file Excel (Câu hỏi và Danh sách)!");
            statusEl.innerText = "";
            return;
        }

        // 1. Lưu Cấu Hình Bài Thi
        const testConfigData = {
            title: document.getElementById('testTitle').value,
            duration: parseInt(document.getElementById('duration').value),
            startTime: document.getElementById('startTime').value,
            endTime: document.getElementById('endTime').value,
            passScore: parseInt(document.getElementById('passScore').value),
            numSections: parseInt(document.getElementById('numSections').value),
            questionsPerSection: parseInt(document.getElementById('questionsPerSection').value),
            pointsPerQuestion: parseInt(document.getElementById('pointsPerQuestion').value)
        };
        // Dùng 'current_test' làm ID cố định để dễ quản lý bài thi đang mở
        await setDoc(doc(db, "TestConfig", "current_test"), testConfigData);

        // Chuẩn bị Batch Write để ghi nhiều dữ liệu cùng lúc lên Firestore
        const batch = writeBatch(db);

        // 2. Xử lý File Ngân hàng Câu hỏi
        const qData = await readExcelFile(fileQuestions);
        qData.forEach((row, index) => {
            if (row.length >= 2) {
                const questionRef = doc(collection(db, "QuestionBank"));
                // row[0]=Câu hỏi, row[1]=Đ/a Đúng, row[2]...=Đ/a Sai
                batch.set(questionRef, {
                    questionText: row[0],
                    correctAnswer: row[1],
                    wrongAnswers: row.slice(2).filter(ans => ans != null) // Lấy từ cột 3 trở đi, loại bỏ ô trống
                });
            }
        });

        // 3. Xử lý File Danh sách Thí sinh
        const cData = await readExcelFile(fileCandidates);
        cData.forEach((row) => {
            if (row.length >= 6) {
                const cccd = String(row[5]).trim(); // Dùng CCCD làm ID tài liệu để dễ truy vấn đăng nhập
                if (cccd) {
                    const candidateRef = doc(db, "Candidates", cccd);
                    batch.set(candidateRef, {
                        stt: row[0],
                        fullName: row[1],
                        dob: row[2],
                        title: row[3],
                        gender: row[4],
                        cccd: cccd
                    });
                }
            }
        });

        // Thực thi toàn bộ lệnh ghi
        await batch.commit();
        
        statusEl.style.color = "green";
        statusEl.innerText = "Lưu dữ liệu thành công! Ngân hàng câu hỏi và Danh sách thí sinh đã sẵn sàng.";

    } catch (error) {
        console.error("Lỗi khi lưu dữ liệu:", error);
        statusEl.style.color = "red";
        statusEl.innerText = "Có lỗi xảy ra. Vui lòng kiểm tra Console (F12).";
    }
});
