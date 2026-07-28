import { db } from './firebase-config.js';
// Bổ sung thêm getDoc, updateDoc
import { doc, getDoc, updateDoc, setDoc, writeBatch, collection, getDocs, query, where, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let sectionCount = 0;
let scoreChartInstance = null;
let titleDebounceTimer = null; // Biến dùng cho tính năng kiểm tra độ trễ gõ phím

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

document.addEventListener('DOMContentLoaded', () => {
    
    // --- KHỞI TẠO ---
    document.getElementById('btnAddSection')?.addEventListener('click', addSectionBlock);
    addSectionBlock(); 
    loadTestHistory();

    // --- KIỂM TRA TRÙNG TÊN THỜI GIAN THỰC (REAL-TIME) ---
    document.getElementById('testTitle')?.addEventListener('input', (e) => {
        clearTimeout(titleDebounceTimer);
        const title = e.target.value.trim();
        const msgEl = document.getElementById('titleCheckMsg');
        
        if(!title) { msgEl.innerText = ""; return; }
        
        msgEl.innerText = "⏳ Đang kiểm tra...";
        msgEl.style.color = "#ffc107"; // Màu vàng
        
        // Đợi 0.5s sau khi ngừng gõ mới truy vấn database
        titleDebounceTimer = setTimeout(async () => {
            try {
                const qTitleCheck = query(collection(db, "TestConfig"), where("title", "==", title));
                const titleSnap = await getDocs(qTitleCheck);
                
                if (!titleSnap.empty) {
                    msgEl.innerText = "❌ Tên này đã tồn tại!";
                    msgEl.style.color = "red";
                } else {
                    msgEl.innerText = "✅ Tên hợp lệ!";
                    msgEl.style.color = "green";
                }
            } catch (error) {
                msgEl.innerText = "Lỗi mạng!";
            }
        }, 500); 
    });


    // --- LƯU BÀI THI MỚI ---
    document.getElementById('btnSaveData')?.addEventListener('click', async () => {
        const statusEl = document.getElementById('statusMessage');
        const testTitle = document.getElementById('testTitle').value.trim();
        
        if (!testTitle) { alert("Vui lòng nhập tên bài thi!"); return; }

        statusEl.style.color = "blue";
        statusEl.innerText = "Đang kiểm tra hệ thống...";

        try {
            // Check lại trùng tên lần cuối trước khi lưu (đề phòng)
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
            statusEl.innerText = `Lưu thành công!`;
            
            document.getElementById('titleCheckMsg').innerText = "";
            document.getElementById('testTitle').value = "";
            loadTestHistory();

        } catch (error) {
            console.error("Lỗi lưu:", error);
            statusEl.style.color = "red";
            statusEl.innerText = "Lỗi khi lưu dữ liệu. Kiểm tra Console.";
        }
    });

    // --- MỞ FORM SỬA CẤU HÌNH ---
    document.getElementById('btnEditTest')?.addEventListener('click', async () => {
        const testId = document.getElementById('historyTestSelect').value;
        if (!testId) { alert("Vui lòng chọn 1 bài thi để sửa!"); return; }

        try {
            const docSnap = await getDoc(doc(db, "TestConfig", testId));
            if(docSnap.exists()) {
                const data = docSnap.data();
                document.getElementById('editTestTitle').value = data.title;
                document.getElementById('editDuration').value = data.duration;
                document.getElementById('editStartTime').value = data.startTime;
                document.getElementById('editEndTime').value = data.endTime;
                document.getElementById('editPassScore').value = data.passScore;
                
                // Hiện form lên
                document.getElementById('editConfigSection').style.display = 'block';
            }
        } catch (error) {
            console.error(error);
            alert("Không thể tải cấu hình bài thi!");
        }
    });

    // --- ĐÓNG FORM SỬA ---
    document.getElementById('btnCancelEdit')?.addEventListener('click', () => {
        document.getElementById('editConfigSection').style.display = 'none';
    });

    // --- LƯU THAY ĐỔI CẤU HÌNH ---
    document.getElementById('btnSaveEdit')?.addEventListener('click', async () => {
        const testId = document.getElementById('historyTestSelect').value;
        const newTitle = document.getElementById('editTestTitle').value.trim();
        
        if(!newTitle) { alert("Tiêu đề không được để trống!"); return; }

        try {
            // Kiểm tra trùng tên với bài thi KHÁC (Tránh việc update chính nó mà bị báo trùng)
            const qTitleCheck = query(collection(db, "TestConfig"), where("title", "==", newTitle));
            const titleSnap = await getDocs(qTitleCheck);
            
            let isDuplicate = false;
            titleSnap.forEach(d => {
                if (d.id !== testId) isDuplicate = true; 
            });

            if (isDuplicate) { 
                alert(`Tiêu đề "${newTitle}" đã được sử dụng bởi bài thi khác!`); 
                return; 
            }

            // Tiến hành cập nhật
            await updateDoc(doc(db, "TestConfig", testId), {
                title: newTitle,
                duration: parseInt(document.getElementById('editDuration').value),
                startTime: document.getElementById('editStartTime').value,
                endTime: document.getElementById('editEndTime').value,
                passScore: parseInt(document.getElementById('editPassScore').value)
            });

            alert("Đã cập nhật cấu hình bài thi thành công!");
            document.getElementById('editConfigSection').style.display = 'none';
            loadTestHistory(); // Cập nhật lại dropdown tên bài thi

        } catch (error) {
            console.error("Lỗi cập nhật:", error);
            alert("Lỗi khi lưu thay đổi!");
        }
    });


    // --- XÓA BÀI THI ---
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
            document.getElementById('editConfigSection').style.display = 'none';
            loadTestHistory();
        } catch (error) {
            console.error("Lỗi xóa:", error);
            alert("Lỗi khi xóa bài thi!");
        }
        btnDel.innerText = "Xóa Bài Thi";
    });


    // --- XEM THỐNG KÊ ---
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

// --- CÁC HÀM TIỆN ÍCH ---
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
