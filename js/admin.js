import { db } from './firebase-config.js';
import { doc, setDoc, writeBatch, collection, getDocs, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let sectionCount = 0;
let scoreChartInstance = null;

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            resolve(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }).slice(1));
        };
        reader.onerror = error => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

function addSectionBlock(event) {
    if(event) event.preventDefault();
    sectionCount++;
    const container = document.getElementById('sectionsContainer');
    if(!container) return;

    const div = document.createElement('div');
    div.className = 'section-block';
    div.id = `sectionBlock_${sectionCount}`;
    
    div.innerHTML = `
        <h4>Section ${sectionCount}</h4>
        <button type="button" class="btn-remove" onclick="document.getElementById('${div.id}').remove()">Xóa</button>
        <div class="form-group"><label>Số câu hỏi rút ra:</label><input type="number" class="sec-questions" value="10" required></div>
        <div class="form-group"><label>Điểm mỗi câu hỏi:</label><input type="number" class="sec-points" value="5" required></div>
        <div class="form-group"><label>Upload File Ngân hàng câu hỏi (Excel):</label><input type="file" class="sec-file" accept=".xlsx, .xls" required></div>
    `;
    container.appendChild(div);
}

// BỌC TOÀN BỘ SỰ KIỆN TRONG DOMContentLoaded ĐỂ CHỐNG LỖI NULL
document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Nút Thêm Section
    document.getElementById('btnAddSection')?.addEventListener('click', addSectionBlock);
    addSectionBlock(); // Tự động thêm 1 section lúc đầu
    loadTestHistory(); // Tải danh sách lúc đầu

    // 2. Nút Lưu Bài Thi
    document.getElementById('btnSaveData')?.addEventListener('click', async () => {
        const statusEl = document.getElementById('statusMessage');
        const testTitle = document.getElementById('testTitle').value.trim();
        
        if (!testTitle) { alert("Vui lòng nhập tên bài thi!"); return; }

        statusEl.style.color = "blue";
        statusEl.innerText = "Đang kiểm tra hệ thống...";

        try {
            const qTitleCheck = query(collection(db, "TestConfig"), where("title", "==", testTitle));
            const titleSnap = await getDocs(qTitleCheck);
            if (!titleSnap.empty) {
                alert(`Tên bài thi "${testTitle}" đã tồn tại! Vui lòng chọn một tên khác.`);
                statusEl.innerText = "";
                return;
            }

            const fileCandidates = document.getElementById('fileCandidates').files[0];
            const sectionBlocks = document.querySelectorAll('.section-block');
            
            if (!fileCandidates || sectionBlocks.length === 0) {
                alert("Vui lòng upload danh sách thí sinh và ít nhất 1 Section!");
                statusEl.innerText = ""; return;
            }

            statusEl.innerText = "Đang lưu dữ liệu, vui lòng không tắt trang...";
            const testId = "test_" + Date.now();
            let testSectionsData = [];
            const batch = writeBatch(db);

            for (let i = 0; i < sectionBlocks.length; i++) {
                const block = sectionBlocks[i];
                const qFile = block.querySelector('.sec-file').files[0];
                const sectionId = "sec_" + (i + 1);
                testSectionsData.push({ 
                    sectionId: sectionId, 
                    numQuestions: parseInt(block.querySelector('.sec-questions').value), 
                    pointsPerQuestion: parseInt(block.querySelector('.sec-points').value) 
                });

                if (qFile) {
                    const qData = await readExcelFile(qFile);
                    qData.forEach((row) => {
                        if (row && row[0] !== undefined && row[1] !== undefined) {
                            const questionRef = doc(collection(db, "QuestionBank"));
                            const wrongAnswers = row.slice(2).filter(ans => ans !== undefined && ans !== null && String(ans).trim() !== "");
                            batch.set(questionRef, {
                                testId: testId, sectionId: sectionId,
                                questionText: String(row[0]).trim(),
                                correctAnswer: String(row[1]).trim(),
                                wrongAnswers: wrongAnswers.map(ans => String(ans).trim())
                            });
                        }
                    });
                }
            }

            const testConfigData = {
                testId: testId, title: testTitle,
                duration: parseInt(document.getElementById('duration').value),
                startTime: document.getElementById('startTime').value,
                endTime: document.getElementById('endTime').value,
                passScore: parseInt(document.getElementById('passScore').value),
                sections: testSectionsData,
                createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, "TestConfig", testId), testConfigData);

            const cData = await readExcelFile(fileCandidates);
            cData.forEach((row) => {
                if (row && row[5] !== undefined && row[5] !== null) {
                    const cccd = String(row[5]).trim();
                    if (cccd !== "" && cccd !== "undefined") {
                        batch.set(doc(db, "Candidates", testId + "_" + cccd), {
                            testId: testId, cccd: cccd,
                            stt: row[0] !== undefined ? row[0] : "",
                            fullName: row[1] !== undefined ? String(row[1]).trim() : "",
                            dob: row[2] !== undefined ? String(row[2]).trim() : "",
                            title: row[3] !== undefined ? String(row[3]).trim() : "",
                            gender: row[4] !== undefined ? String(row[4]).trim() : ""
                        });
                    }
                }
            });

            await batch.commit();
            statusEl.style.color = "green";
            statusEl.innerText = `Lưu thành công! Mã bài thi: ${testId}`;
            loadTestHistory();

        } catch (error) {
            console.error("Lỗi lưu:", error);
            statusEl.style.color = "red";
            statusEl.innerText = "Lỗi khi lưu dữ liệu. Kiểm tra Console.";
        }
    });

    // 3. Nút Xóa Bài Thi
    document.getElementById('btnDeleteTest')?.addEventListener('click', async () => {
        const testId = document.getElementById('historyTestSelect').value;
        if (!testId) { alert("Vui lòng chọn 1 bài thi ở danh sách bên trái để xóa!"); return; }
        
        if (!confirm("CẢNH BÁO MẤT DỮ LIỆU!\nBạn có chắc chắn muốn XÓA TOÀN BỘ Cấu hình, Danh sách, Câu hỏi và Bài làm của bài thi này không?")) return;

        const btnDel = document.getElementById('btnDeleteTest');
        btnDel.innerText = "Đang xóa...";
        try {
            const collectionsToDelete = ["Submissions", "Candidates", "QuestionBank"];
            const deletePromises = [];

            for (const colName of collectionsToDelete) {
                const q = query(collection(db, colName), where("testId", "==", testId));
                const snap = await getDocs(q);
                snap.forEach(d => deletePromises.push(deleteDoc(doc(db, colName, d.id))));
            }
            
            await Promise.all(deletePromises);
            await deleteDoc(doc(db, "TestConfig", testId));

            alert("Đã xóa bài thi thành công!");
            document.getElementById('statsSummary').style.display = 'none';
            loadTestHistory();
        } catch (error) {
            console.error("Lỗi xóa:", error);
            alert("Lỗi khi xóa bài thi!");
        }
        btnDel.innerText = "Xóa Bài Thi";
    });

    // 4. Nút Xem Thống Kê
    document.getElementById('btnLoadStats')?.addEventListener('click', async () => {
        const testId = document.getElementById('historyTestSelect').value;
        if (!testId) { alert("Vui lòng chọn 1 bài thi từ danh sách!"); return; }

        const btnLoad = document.getElementById('btnLoadStats');
        btnLoad.innerText = "Đang tải dữ liệu...";
        const tbody = document.querySelector('#resultsTable tbody');
        if(tbody) tbody.innerHTML = ""; 

        try {
            const q = query(collection(db, "Submissions"), where("testId", "==", testId));
            const subSnapshot = await getDocs(q);
            
            let total = 0, passed = 0, failed = 0;
            let scoreFreq = {}; 

            subSnapshot.forEach(docSnap => {
                total++;
                const data = docSnap.data();
                if (data.isPassed) passed++; else failed++;
                scoreFreq[data.score] = (scoreFreq[data.score] || 0) + 1;

                if(tbody) {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td>${data.cccd || "N/A"}</td>
                        <td>${data.fullName || "N/A"}</td>
                        <td><strong>${data.score}</strong></td>
                        <td style="color: ${data.isPassed ? 'green' : 'red'}; font-weight: bold;">${data.isPassed ? 'ĐẠT' : 'TRƯỢT'}</td>
                        <td>${new Date(data.submittedAt).toLocaleString('vi-VN')}</td>`;
                    tbody.appendChild(tr);
                }
            });

            document.getElementById('totalSubs').innerText = total;
            document.getElementById('passedSubs').innerText = passed;
            document.getElementById('failedSubs').innerText = failed;
            document.getElementById('statsSummary').style.display = 'block';

            try {
                const labels = Object.keys(scoreFreq).sort((a, b) => Number(a) - Number(b)); 
                const dataPoints = labels.map(label => scoreFreq[label]);
                drawChart(labels, dataPoints);
            } catch (errChart) {
                console.warn("Bỏ qua lỗi vẽ biểu đồ:", errChart);
            }
            
            btnLoad.innerText = "Xem Thống Kê";
            if (total === 0) alert("Bài thi này hiện chưa có ai làm hoặc nộp bài!");

        } catch (error) {
            console.error("Lỗi kéo thống kê:", error);
            alert("Lỗi tải dữ liệu. Vui lòng thử lại!");
            btnLoad.innerText = "Xem Thống Kê";
        }
    });

}); // <-- Kết thúc hàm DOMContentLoaded

async function loadTestHistory() {
    const selectBox = document.getElementById('historyTestSelect');
    if(!selectBox) return;
    
    selectBox.innerHTML = '<option value="">-- Đang tải... --</option>';
    try {
        const snapshot = await getDocs(collection(db, "TestConfig"));
        selectBox.innerHTML = '<option value="">-- Chọn một bài thi --</option>';
        snapshot.forEach(docSnap => {
            if(docSnap.id !== "current_test") {
                const data = docSnap.data();
                const option = document.createElement('option');
                option.value = data.testId;
                option.textContent = `${data.title} (Tạo: ${new Date(data.createdAt).toLocaleDateString('vi-VN')})`;
                selectBox.appendChild(option);
            }
        });
    } catch (error) {
        console.error("Lỗi lấy danh sách bài thi:", error);
    }
}

function drawChart(labels, dataPoints) {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById('scoreChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (scoreChartInstance) scoreChartInstance.destroy();
    
    scoreChartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ label: 'Số người đạt mức điểm', data: dataPoints, backgroundColor: 'rgba(54, 162, 235, 0.6)' }] },
        options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}
