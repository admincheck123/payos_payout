// public/app.js
// DOM
const navHome = document.getElementById("navHome");
const navHistory = document.getElementById("navHistory");
const pageHome = document.getElementById("pageHome");
const pageHistory = document.getElementById("pageHistory");

// Home elements
const balanceEl = document.getElementById("balance");
const refreshBalanceBtn = document.getElementById("refreshBalance");
const payoutForm = document.getElementById("payoutForm");
const referenceIdEl = document.getElementById("referenceId");
const amountEl = document.getElementById("amount");
const categoryEl = document.getElementById("category");
const descriptionEl = document.getElementById("description");
const bankSearchEl = document.getElementById("bankSearch");
const bankDropdownEl = document.getElementById("bankDropdown");
const selectedBankEl = document.getElementById("selectedBank");
const toBinEl = document.getElementById("toBin");
const accountEl = document.getElementById("toAccountNumber");
const clearBtn = document.getElementById("clearBtn");
const resultEl = document.getElementById("result");

// History elements
const historyBody = document.getElementById("historyBody");
const historyRefresh = document.getElementById("historyRefresh");
const historySearch = document.getElementById("historySearch");
const historyPrev = document.getElementById("historyPrev");
const historyNext = document.getElementById("historyNext");
const historyPageInfo = document.getElementById("historyPageInfo");

// Toast
const toast = document.getElementById("toast");
const toastIcon = document.getElementById("toastIcon");
const toastMsg = document.getElementById("toastMsg");
const toastClose = document.getElementById("toastClose");

// state
let vietqrBanks = []; // array of { short_name, logo, bins }
let bankDropdownVisible = false;
let histPage = 1;
const histLimit = 10;
let histTotalPages = 1;

// utils
function formatMoney(v) {
    const n = Number(v) || 0;
    return new Intl.NumberFormat('vi-VN').format(n) + ' ₫';
}
function showToast(type, message, ttl = 4500) {
    toast.classList.remove('hidden');
    toastMsg.textContent = message;
    toastIcon.className = 'toast-icon';
    if (type === 'success') { toastIcon.classList.add('success'); toastIcon.textContent = '✓'; }
    else if (type === 'failed') { toastIcon.classList.add('failed'); toastIcon.textContent = '✕'; }
    else { toastIcon.textContent = 'ℹ'; }
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), ttl);
}
toastClose.addEventListener('click', () => { toast.classList.add('hidden'); clearTimeout(toast._timer); });

// NAV
function showPage(name) {
    if (name === 'home') {
        pageHome.classList.add('active');
        pageHistory.classList.remove('active');
        navHome.classList.add('active');
        navHistory.classList.remove('active');
    } else {
        pageHome.classList.remove('active');
        pageHistory.classList.add('active');
        navHome.classList.remove('active');
        navHistory.classList.add('active');
    }
}
navHome.addEventListener('click', () => showPage('home'));
navHistory.addEventListener('click', () => { showPage('history'); loadHistory(1); });

// BALANCE
async function fetchBalance() {
    balanceEl.textContent = 'Đang tải...';
    try {
        const r = await fetch('/api/balance');
        const data = await r.json();
        const bal = data?.data?.balance ?? data?.balance ?? null;
        balanceEl.textContent = (typeof bal === 'number') ? formatMoney(bal) : (bal ? String(bal).slice(0, 40) : '--');
    } catch (err) {
        console.error(err);
        balanceEl.textContent = 'Lỗi tải';
    }
}
refreshBalanceBtn.addEventListener('click', fetchBalance);

// VIETQR BANKS (populate dropdown)
async function loadVietqrBanks() {
    bankDropdownEl.innerHTML = '';
    try {
        const r = await fetch('/api/vietqr-banks');
        if (!r.ok) {
            console.warn('vietqr api returned', r.status);
            return;
        }
        const j = await r.json();
        vietqrBanks = j?.data ?? [];
        // we don't render everything at once; dropdown will show filtered results
    } catch (err) {
        console.error('vietqr fetch error', err);
    }
}

// open dropdown with filtered results
function showBankDropdown(filtered) {
    if (!filtered || !filtered.length) {
        bankDropdownEl.innerHTML = `<div class="bank-dropdown"><div class="list"><div class="bank-item muted" style="padding:12px">Không tìm thấy</div></div></div>`;
    } else {
        const slice = filtered.slice(0, 30); // avoid too many
        bankDropdownEl.innerHTML = `<div class="bank-dropdown"><div class="list">${slice.map(b => {
            const binStr = Array.isArray(b.bins) ? b.bins.slice(0, 3).join(', ') : (b.bins || '-');
            const logo = b.logo ? `<img src="${b.logo}" alt="${b.short_name}"/>` : `<div style="width:36px;height:24px;border-radius:6px;background:#f0f4f5"></div>`;
            return `<div class="bank-item" data-bin="${Array.isArray(b.bins) ? b.bins[0] : (b.bins || '')}" data-name="${b.short_name}" data-logo="${b.logo ?? ''}">
        ${logo}
        <div class="meta"><div class="name">${b.short_name}</div><div class="sub">BIN: ${binStr}</div></div>
      </div>`;
        }).join('')}</div></div>`;
    }
    bankDropdownEl.classList.remove('hidden');
    bankDropdownVisible = true;

    // attach click events
    bankDropdownEl.querySelectorAll('.bank-item').forEach(node => {
        node.addEventListener('click', () => {
            const bin = node.dataset.bin || '';
            const name = node.dataset.name || '';
            const logo = node.dataset.logo || '';
            toBinEl.value = bin;
            bankSearchEl.value = name;
            selectedBankEl.innerHTML = logo ? `<img src="${logo}" alt="${name}"><div style="font-weight:700">${name}</div>` : `<div style="font-weight:700">${name}</div>`;
            selectedBankEl.classList.remove('hidden');
            bankDropdownEl.classList.add('hidden');
            bankDropdownVisible = false;
            accountEl.focus();
            showToast('info', `Đã chọn: ${name} (BIN ${bin})`, 2000);
        });
    });
}

// filter on input
bankSearchEl.addEventListener('input', (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    if (!q) {
        bankDropdownEl.classList.add('hidden');
        bankDropdownVisible = false;
        return;
    }
    const filtered = vietqrBanks.filter(b => (b.short_name || '').toLowerCase().includes(q) || (String(b.bins || '')).includes(q));
    showBankDropdown(filtered);
});

// close dropdown on outside click
document.addEventListener('click', (e) => {
    if (!bankDropdownEl.contains(e.target) && e.target !== bankSearchEl) {
        bankDropdownEl.classList.add('hidden');
        bankDropdownVisible = false;
    }
});

// PAYOUT form submit
payoutForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    resultEl.textContent = 'Đang gửi lệnh...';
    const body = {
        referenceId: referenceIdEl.value.trim(),
        amount: Number(amountEl.value),
        description: descriptionEl.value || "",
        toBin: toBinEl.value.trim(),
        toAccountNumber: accountEl.value.trim(),
        category: categoryEl.value ? [categoryEl.value.trim()] : []
    };

    if (!body.referenceId || !body.amount || !body.toBin || !body.toAccountNumber) {
        resultEl.textContent = 'Vui lòng điền đầy đủ referenceId, amount, toBin và toAccountNumber';
        return;
    }

    try {
        const r = await fetch('/api/payouts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await r.json();
        if (!r.ok) {
            showToast('failed', `Gửi thất bại: ${data?.message || r.statusText}`, 6000);
            resultEl.textContent = JSON.stringify(data, null, 2);
            return;
        }
        const payosResponse = data?.payosResponse ?? data;
        const code = payosResponse?.code ?? payosResponse?.status ?? '';
        const isSuccess = (String(code) === '00') || (payosResponse?.data && payosResponse.data?.transactions && payosResponse.data.transactions.some(t => t.state === 'SUCCEEDED')) || (payosResponse?.data?.approvalState === 'COMPLETED');

        if (isSuccess) {
            showToast('success', 'Chuyển tiền thành công', 6000);
            renderResultSuccess(payosResponse);
            fetchBalance();
            loadHistory(1);
        } else {
            const desc = payosResponse?.desc ?? payosResponse?.message ?? 'Không thành công';
            showToast('failed', `Không thành công: ${desc}`, 6000);
            resultEl.textContent = JSON.stringify(payosResponse, null, 2);
        }
    } catch (err) {
        console.error(err);
        showToast('failed', 'Lỗi kết nối khi gửi lệnh', 6000);
        resultEl.textContent = 'Lỗi gửi lệnh: ' + (err.message || err);
    }
});

function renderResultSuccess(payosData) {
    const data = payosData?.data ?? payosData;
    const txs = Array.isArray(data?.transactions) ? data.transactions : [];
    let html = `<div><span class="status success">Đã chuyển thành công</span></div>`;
    html += `<div style="margin-top:10px;color:#6b7280">Mã lô: <strong>${data?.id ?? '-'}</strong></div>`;
    if (txs.length) {
        const t = txs[0];
        html += `<div class="tx-details">
      <div class="tx-row"><div class="k">Số tiền</div><div class="v">${formatMoney(t.amount)}</div></div>
      <div class="tx-row"><div class="k">Người nhận</div><div class="v">${t.toAccountName ?? '-'}</div></div>
      <div class="tx-row"><div class="k">Số tài khoản</div><div class="v">${t.toAccountNumber ?? '-'}</div></div>
      <div class="tx-row"><div class="k">Ngân hàng (BIN)</div><div class="v">${t.toBin ?? '-'}</div></div>
      <div class="tx-row"><div class="k">Mô tả</div><div class="v">${t.description ?? '-'}</div></div>
      <div class="tx-row"><div class="k">Thời gian</div><div class="v">${t.transactionDatetime ?? data?.createdAt ?? '-'}</div></div>
      <div class="tx-row"><div class="k">Trạng thái</div><div class="v">${t.state ?? '-'}</div></div>
    </div>`;
    } else {
        html += `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    }
    resultEl.innerHTML = html;
}

// HISTORY
async function loadHistory(page = 1, search = "") {
    historyBody.innerHTML = `<tr><td colspan="7" class="muted">Đang tải...</td></tr>`;
    try {
        const params = new URLSearchParams();
        params.set('page', page);
        params.set('limit', histLimit);
        if (search) params.set('q', search);
        const r = await fetch(`/api/history?${params.toString()}`);
        const data = await r.json();

        let items = [];
        if (Array.isArray(data?.data)) items = data.data;
        else if (Array.isArray(data?.items)) items = data.items;
        else if (Array.isArray(data?.result)) items = data.result;
        else if (Array.isArray(data)) items = data;
        else if (data?.data && Array.isArray(data.data?.batches)) items = data.data.batches;
        else if (data?.data && Array.isArray(data.data?.transactions)) items = data.data.transactions;

        if (!items || !items.length) {
            historyBody.innerHTML = `<tr><td colspan="7" class="muted">Không có dữ liệu</td></tr>`;
            historyPageInfo.textContent = `Trang ${page} / 1`;
            histTotalPages = 1;
            histPage = 1;
            return;
        }

        const total = data?.data?.total ?? data?.total ?? (items.length);
        histTotalPages = Math.max(1, Math.ceil((total || items.length) / histLimit));
        histPage = page;
        historyPageInfo.textContent = `Trang ${histPage} / ${histTotalPages}`;

        historyBody.innerHTML = items.map(it => {
            const batchId = it.id ?? it.batchId ?? it.batch_id ?? '-';
            const reference = it.referenceId ?? it.reference ?? (it.data?.referenceId) ?? '-';
            const txn = (Array.isArray(it.transactions) && it.transactions[0]) ? it.transactions[0] : (it.transaction ?? it);
            const amount = txn?.amount ?? it?.amount ?? '-';
            const recipient = txn?.toAccountName ?? txn?.toAccountNumber ?? '-';
            const bin = txn?.toBin ?? '-';
            const time = txn?.transactionDatetime ?? it?.createdAt ?? '-';
            const status = txn?.state ?? it?.approvalState ?? it?.status ?? '-';
            return `<tr>
        <td>${batchId}</td>
        <td>${reference}</td>
        <td>${(typeof amount === 'number') ? formatMoney(amount) : amount}</td>
        <td>${recipient}</td>
        <td>${bin}</td>
        <td>${time}</td>
        <td>${status}</td>
      </tr>`;
        }).join('');
    } catch (err) {
        console.error(err);
        historyBody.innerHTML = `<tr><td colspan="7" class="muted">Lỗi tải lịch sử</td></tr>`;
    }
}

historyRefresh.addEventListener('click', () => loadHistory(1, historySearch.value.trim()));
historySearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadHistory(1, historySearch.value.trim()); });
historyPrev.addEventListener('click', () => { if (histPage > 1) loadHistory(histPage - 1, historySearch.value.trim()); });
historyNext.addEventListener('click', () => { if (histPage < histTotalPages) loadHistory(histPage + 1, historySearch.value.trim()); });

// init
referenceIdEl.value = `payout_${Date.now()}`;
loadVietqrBanks().then(() => {
    // optionally prefill bankSearch with first few suggestions
});
fetchBalance();
