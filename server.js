// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const PAYOS_API_URL = process.env.PAYOS_API_URL || "https://api-merchant.payos.vn";
const CLIENT_ID = process.env.PAYOS_CLIENT_ID;
const API_KEY = process.env.PAYOS_API_KEY;
const CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY;

if (!CLIENT_ID || !API_KEY || !CHECKSUM_KEY) {
    console.error("Missing PAYOS env variables. Please set PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY");
    process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ---------- helpers ----------
function sortObjDataByKey(obj) {
    const ordered = {};
    Object.keys(obj).sort().forEach(k => ordered[k] = obj[k]);
    return ordered;
}
function convertObjToQueryStr(object) {
    return Object.keys(object)
        .filter((key) => object[key] !== undefined)
        .map((key) => {
            let value = object[key];
            if (value === null || value === undefined || value === "undefined" || value === "null") {
                value = "";
            } else if (Array.isArray(value)) {
                value = JSON.stringify(value);
            } else if (typeof value === "object") {
                value = JSON.stringify(value);
            }
            return `${key}=${encodeURI(value)}`;
        })
        .join("&");
}
function createPayOSSignature(data, checksumKey) {
    const sorted = sortObjDataByKey(data);
    const q = convertObjToQueryStr(sorted);
    const hmac = crypto.createHmac("sha256", checksumKey);
    hmac.update(q);
    return hmac.digest("hex");
}

// ---------- bankcodes (PayOS v2 primary, fallback file) ----------
let bankcodesCache = { ts: 0, ttl: 1000 * 60 * 5, data: null };
const BANKCODES_CANDIDATES = [
    { method: "get", path: "/v2/gateway/api/bankcodes" },
    { method: "post", path: "/v2/gateway/api/bankcodes" },
    { method: "get", path: "/v1/gateway/api/bankcodes" },
    { method: "post", path: "/v1/gateway/api/bankcodes" },
    { method: "get", path: "/gateway/api/bankcodes" },
    { method: "post", path: "/gateway/api/bankcodes" }
];

async function fetchBankcodesFromPayOS() {
    for (const c of BANKCODES_CANDIDATES) {
        const url = `${PAYOS_API_URL}${c.path}`;
        try {
            const resp = await axios({
                url,
                method: c.method,
                headers: { "x-client-id": CLIENT_ID, "x-api-key": API_KEY, "Content-Type": "application/json" },
                timeout: 10000
            });
            let arr = [];
            if (Array.isArray(resp.data)) arr = resp.data;
            else if (Array.isArray(resp.data?.data)) arr = resp.data.data;
            else if (Array.isArray(resp.data?.result)) arr = resp.data.result;
            else {
                const values = Object.values(resp.data || {});
                const found = values.find(v => Array.isArray(v));
                if (found) arr = found;
            }
            if (!Array.isArray(arr) && resp.data && (resp.data.shortName || resp.data.bin)) arr = [resp.data];
            if (Array.isArray(arr)) {
                console.log(`Bankcodes: success via ${c.method.toUpperCase()} ${c.path} (items=${arr.length})`);
                return arr;
            }
        } catch (err) {
            // continue try others
            console.warn(`Bankcodes try ${c.method.toUpperCase()} ${c.path} -> failed:`, err?.response?.data ?? err.message);
        }
    }
    return null;
}

async function getBankcodesEither() {
    const now = Date.now();
    if (bankcodesCache.data && (now - bankcodesCache.ts) <= bankcodesCache.ttl) return bankcodesCache.data;

    const fromPayos = await fetchBankcodesFromPayOS();
    if (Array.isArray(fromPayos)) {
        bankcodesCache = { ts: Date.now(), ttl: bankcodesCache.ttl, data: fromPayos };
        return fromPayos;
    }

    try {
        const jsonPath = path.join(process.cwd(), "data", "bankcodes.json");
        const raw = await fs.readFile(jsonPath, "utf8");
        const arr = JSON.parse(raw);
        console.log(`Bankcodes: using local fallback file (${arr.length} items)`);
        bankcodesCache = { ts: Date.now(), ttl: bankcodesCache.ttl, data: arr };
        return arr;
    } catch (err) {
        console.error("Fallback bankcodes read error:", err.message);
        throw new Error("Không thể lấy được danh sách ngân hàng từ PayOS và file fallback.");
    }
}


app.get("/api/my-ip", async (req, res) => {
    try {
        const r = await axios.get("https://api.ipify.org?format=json");
        res.json({ ip: r.data.ip });
    } catch (err) {
        res.status(500).json({ error: "Không lấy được IP" });
    }
});

// ---------- vietqr.io banks (new) ----------
let vietqrCache = { ts: 0, ttl: 1000 * 60 * 60 * 6, data: null }; // cache 6 hours
app.get("/api/vietqr-banks", async (req, res) => {
    try {
        const now = Date.now();
        if (vietqrCache.data && (now - vietqrCache.ts) <= vietqrCache.ttl) {
            return res.json({ source: "cache", data: vietqrCache.data });
        }

        const url = "https://api.vietqr.io/v2/banks";
        const resp = await axios.get(url, { timeout: 10000 });
        // normalize result: resp.data may be { data: [...] } or an array
        let arr = [];
        if (Array.isArray(resp.data)) arr = resp.data;
        else if (Array.isArray(resp.data?.data)) arr = resp.data.data;
        else if (Array.isArray(resp.data?.result)) arr = resp.data.result;
        // Normalize fields: short_name, logo, bin(s)
        const normalized = (arr || []).map(item => {
            // possible keys variations: short_name, shortName, shortNameEN, logo, bin, bins
            const short_name = item.short_name ?? item.shortName ?? item.shortNameEN ?? item.name ?? item.short ?? "";
            const logo = item.logo ?? item.icon ?? item.image ?? "";
            // bins might be array or single string or under 'bin'
            let bins = item.bin ?? item.bins ?? item.BIN ?? item.bic ?? null;
            if (typeof bins === "string" && bins.includes(",")) {
                bins = bins.split(",").map(s => s.trim());
            }
            if (!bins) bins = item.banks ?? null;
            // ensure array or string
            return { short_name, logo, bins };
        }).filter(b => b.short_name);
        vietqrCache = { ts: Date.now(), ttl: vietqrCache.ttl, data: normalized };
        return res.json({ source: "remote", data: normalized });
    } catch (err) {
        console.error("vietqr fetch error:", err?.response?.data ?? err.message);
        // if remote fails, return empty array (frontend will handle)
        return res.status(500).json({ error: true, message: "Không lấy được danh sách ngân hàng từ vietqr.io", detail: err?.response?.data ?? err.message });
    }
});

// ---------- routes: bankcodes, balance, payouts, history ----------
app.get("/api/bankcodes", async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || "1", 10));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "10", 10)));
        const all = await getBankcodesEither();
        all.sort((a, b) => ((a.shortName || "").toLowerCase().localeCompare((b.shortName || "").toLowerCase())));
        const start = (page - 1) * limit;
        res.json({ total: all.length, page, limit, totalPages: Math.ceil(all.length / limit), data: all.slice(start, start + limit) });
    } catch (err) {
        console.error("Bankcodes route error:", err.message);
        res.status(500).json({ error: true, message: err.message });
    }
});

app.get("/api/balance", async (req, res) => {
    try {
        const url = `${PAYOS_API_URL}/v1/payouts-account/balance`;
        const resp = await axios.get(url, {
            headers: { "x-client-id": CLIENT_ID, "x-api-key": API_KEY, "Content-Type": "application/json" },
            timeout: 10000
        });
        res.json(resp.data);
    } catch (err) {
        console.error("Balance error:", err?.response?.data || err.message);
        res.status(err?.response?.status || 500).json({ error: true, message: err?.response?.data || err.message });
    }
});

app.post("/api/payouts", async (req, res) => {
    try {
        const payload = req.body || {};
        if (!payload.referenceId || !payload.amount || !payload.toAccountNumber || !payload.toBin) {
            return res.status(400).json({ error: true, message: "referenceId, amount, toBin, toAccountNumber are required" });
        }
        const idempotencyKey = uuidv4();
        const signature = createPayOSSignature(payload, CHECKSUM_KEY);
        const url = `${PAYOS_API_URL}/v1/payouts`;
        const resp = await axios.post(url, payload, {
            headers: {
                "x-client-id": CLIENT_ID,
                "x-api-key": API_KEY,
                "Content-Type": "application/json",
                "x-idempotency-key": idempotencyKey,
                "x-signature": signature
            },
            timeout: 15000
        });
        res.json({ idempotencyKey, signature, payosResponse: resp.data });
    } catch (err) {
        console.error("Payout error:", err?.response?.data || err.message);
        res.status(err?.response?.status || 500).json({ error: true, message: err?.response?.data || err.message });
    }
});

// history -> proxy GET /v1/payouts
app.get("/api/history", async (req, res) => {
    try {
        // forward any query params client provided
        const qs = Object.keys(req.query)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(req.query[k])}`)
            .join("&");

        const url = `${PAYOS_API_URL}/v1/payouts${qs ? `?${qs}` : ""}`;

        // *** dùng header bạn cung cấp trực tiếp ở đây ***
        const resp = await axios.get(url, {
            headers: {
                "x-client-id": "182e99a4-e068-41d4-8ec5-3afa4af793f5",
                "x-api-key": "2d180c34-e449-41a6-be49-623570ff7698",
                "Content-Type": "application/json"
            },
            timeout: 15000
        });

        // trả nguyên dữ liệu PayOS về client
        res.json(resp.data);
    } catch (err) {
        console.error("History error:", err?.response?.data ?? err.message);
        res.status(err?.response?.status || 500).json({ error: true, message: err?.response?.data ?? err.message });
    }
});
// serve
app.get("/", (req, res) => res.sendFile("index.html", { root: "./public" }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
