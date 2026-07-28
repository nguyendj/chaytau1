import { db } from './firebase-config.js';
import { doc, setDoc, writeBatch, collection, getDocs, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let sectionCount = 0;
let scoreChartInstance = null;

// Hàm đọc Excel
function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            resolve(XLSX.utils.sheet_to_json(worksheet, { header: 1 }).slice(1));
        };
        reader.onerror = error => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

// ==========================================
// A. LOGIC QUẢN LÝ SECTION ĐỘNG
// ==========================================
function addSectionBlock() {
    sectionCount++;
    const container = document.getElementById('sectionsContainer');
    const div = document.createElement('div');
    div.className = 'section-block';
    div.id = `sectionBlock_${sectionCount}`;
    
    div.innerHTML = `
        <h4>Section ${sectionCount}</h4>
        <button class="btn-remove" onclick="document.getElementById('${div.id}').remove()">Xóa</button>
        <div class="form-group"><label>Số câu hỏi ngẫu nhiên rút ra:</label><input type="number" class="sec-questions" value="10" required></div>
        <div class="form-group"><label>Điểm mỗi câu hỏi:</label><input type="number" class="sec-points" value="5" required></div>
        <div class="form-group"><label>Upload Ngân hàng câu hỏi riêng (Excel):</label><input type="file" class="sec-file" accept=".xlsx, .xls" required></div>
    `;
    container.appendChild(div);
}
document.getElementById('btnAddSection').addEventListener('click', addSectionBlock);

// Tự động thêm 1 section lúc mới tải trang
window.onload = () => {
    addSectionBlock();
    loadTestHistory(); // Tải danh sách bài thi vào dropdown
};


// ==========================================
// B. LƯU BÀI THI MỚI LÊN HỆ THỐNG
// ==========================================
document.getElementById('btnSaveData').addEventListener('click', async () => {
    const statusEl = document.getElementById('statusMessage');
    statusEl.style.color = "blue";
    statusEl.innerText = "Đang xử lý, vui lòng không tắt trang...";

    try {
        const fileCandidates = document.getElementById('fileCandidates').files[0];
        const sectionBlocks = document.querySelectorAll('.section-block');
        
        if (!fileCandidates || sectionBlocks.length === 0) {
            alert("Vui lòng upload danh sách thí sinh và ít nhất 1 Section!");
            statusEl.innerText = ""; return;
        }

        // Tạo ID Bài thi duy nhất dựa trên thời gian
        const testId = "test_" + Date.now();
        const testTitle = document.getElementById('testTitle').value || "Bài thi không tên";

        // 1. Lưu cấu hình chung của Test
        let testSectionsData = [];
        const batch = writeBatch(db);

        // 2. Xử lý từng Section
        for (let i = 0; i < sectionBlocks.length; i++) {
            const block = sectionBlocks[i];
            const qFile = block.querySelector('.sec-file').files[0];
            const numQ = parseInt(block.querySelector('.sec-questions').value);
            const pts = parseInt(block.querySelector('.sec-points').value);
            const sectionId = "sec_" + (i + 1);

            testSectionsData.push({ sectionId, numQuestions: numQ, pointsPerQuestion: pts });

            if (qFile) {
                const qData = await readExcelFile(qFile);
                qData.forEach((row) => {
                    if (row && row[0] !== undefined && row[1] !== undefined) {
                        const questionRef = doc(collection(db, "QuestionBank"));
                        const wrongAnswers = row.slice(2).filter(ans => ans !== undefined && ans !== null && String(ans).trim() !== "");
                        batch.set(questionRef, {
                            testId: testId,             // Gắn ID bài thi
                            sectionId: sectionId,       // Gắn ID section
                            questionText: String(row[0]).trim(),
                            correctAnswer: String(row[1]).trim(),
                            wrongAnswers: wrongAnswers.map(ans => String(ans).trim())
                        });
                    }
                });
            }
        }

        // Cập nhật Document bài thi
        const testConfigData = {
            testId: testId,
            title: testTitle,
            duration: parseInt(document.getElementById('duration').value),
            startTime: document.getElementById('startTime').value,
            endTime: document.getElementById('endTime').value,
            passScore: parseInt(document.getElementById('passScore').value),
            sections: testSectionsData, // Lưu mảng cấu hình các section
            createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, "TestConfig", testId), testConfigData);
        
        // Thiết lập bài thi này làm "Bài thi đang kích hoạt" để User.js biết đường truy cập
        await setDoc(doc(db, "System", "ActiveTest"), { activeTestId: testId });

       // 3. Xử lý danh sách thí sinh
        const cData = await readExcelFile(fileCandidates);
        cData.forEach((row) => {
            if (row && row[5] !== undefined && row[5] !== null) {
                const cccd = String(row[5]).trim();
                if (cccd !== "" && cccd !== "undefined") {
                    const candidateRef = doc(db, "Candidates", testId + "_" + cccd); 
                    batch.set(candidateRef, {
                        testId: testId,
                        stt: row[0] !== undefined ? row[0] : "",
                        fullName: row[1] !== undefined ? String(row[1]).trim() : "",
                        dob: row[2] !== undefined ? String(row[2]).trim() : "",       // Đã bổ sung Ngày sinh
                        title: row[3] !== undefined ? String(row[3]).trim() : "",     // Đã bổ sung Chức danh
                        gender: row[4] !== undefined ? String(row[4]).trim() : "",   // Đã bổ sung Giới tính
                        cccd: cccd
                    });
                }
            }
        });

        await batch.commit();
        statusEl.style.color = "green";
        statusEl.innerText = `Lưu thành công! Mã bài thi: ${testId}`;
        loadTestHistory(); // Cập nhật lại Dropdown

    } catch (error) {
        console.error("Lỗi:", error);
        statusEl.style.color = "red";
        statusEl.innerText = "Lỗi khi lưu dữ liệu. Kiểm tra Console.";
    }
});

// ==========================================
// C. LOGIC TẢI DANH SÁCH BÀI THI & THỐNG KÊ
// ==========================================
async function loadTestHistory() {
    const selectBox = document.getElementById('historyTestSelect');
    selectBox.innerHTML = '<option value="">-- Đang tải... --</option>';
    try {
        const snapshot = await getDocs(collection(db, "TestConfig"));
        selectBox.innerHTML = '<option value="">-- Chọn một bài thi --</option>';
        snapshot.forEach(doc => {
            if(doc.id !== "current_test") { // Bỏ qua bản ghi cũ nếu còn
                const data = doc.data();
                const option = document.createElement('option');
                option.value = data.testId;
                // Hiển thị Tên bài thi + Ngày tạo
                const dateStr = new Date(data.createdAt).toLocaleDateString('vi-VN');
                option.textContent = `${data.title} (Tạo ngày: ${dateStr})`;
                selectBox.appendChild(option);
            }
        });
    } catch (error) {
        console.error("Lỗi lấy danh sách bài thi:", error);
    }
}

document.getElementById('btnLoadStats').addEventListener('click', async () => {
    const testId = document.getElementById('historyTestSelect').value;
    if (!testId) { alert("Vui lòng chọn 1 bài thi từ danh sách!"); return; }

    document.getElementById('btnLoadStats').innerText = "Đang tải...";
    const tbody = document.querySelector('#resultsTable tbody');
    tbody.innerHTML = ""; 

    try {
        // Truy vấn dữ liệu nộp bài CHỈ THUỘC VỀ testId được chọn
        const q = query(collection(db, "Submissions"), where("testId", "==", testId));
        const subSnapshot = await getDocs(q);
        
        let total = 0, passed = 0, failed = 0;
        let scoreFreq = {}; 

        subSnapshot.forEach(doc => {
            total++;
            const data = doc.data();
            
            if (data.isPassed) passed++; else failed++;

            // Thống kê phổ điểm
            const score = data.score;
            scoreFreq[score] = (scoreFreq[score] || 0) + 1;

            // Chèn dòng vào Bảng
            const tr = document.createElement('tr');
            const submitTime = new Date(data.submittedAt).toLocaleString('vi-VN');
            const statusColor = data.isPassed ? 'green' : 'red';
            const statusText = data.isPassed ? 'ĐẠT' : 'TRƯỢT';

            tr.innerHTML = `
                <td>${data.cccd}</td>
                <td>${data.fullName}</td>
                <td><strong>${data.score}</strong></td>
                <td style="color: ${statusColor}; font-weight: bold;">${statusText}</td>
                <td>${submitTime}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('totalSubs').innerText = total;
        document.getElementById('passedSubs').innerText = passed;
        document.getElementById('failedSubs').innerText = failed;
        document.getElementById('statsSummary').style.display = 'block';

        // Vẽ biểu đồ
        const labels = Object.keys(scoreFreq).sort((a, b) => Number(a) - Number(b)); 
        const dataPoints = labels.map(label => scoreFreq[label]);
        drawChart(labels, dataPoints);
        
        document.getElementById('btnLoadStats').innerText = "Xem Thống Kê";
    } catch (error) {
        console.error(error);
        alert("Lỗi tải thống kê!");
        document.getElementById('btnLoadStats').innerText = "Xem Thống Kê";
    }
});

function drawChart(labels, dataPoints) {
    const ctx = document.getElementById('scoreChart').getContext('2d');
    if (scoreChartInstance) scoreChartInstance.destroy();
    scoreChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Số người đạt mức điểm',
                data: dataPoints,
                backgroundColor: 'rgba(54, 162, 235, 0.6)'
            }]
        },
        options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}
