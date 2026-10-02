# Smart Monitor V1

> **Ухаалаг орчны мониторингийн станц** — ESP32 мэдээлэл цуглуулах станц + capability-driven
> cloud backend + realtime web dashboard.

Энэ төсөл **бүтээгдэхүүн гэр бүлийн анхны загвар** (`smart_monitor_v1`) юм. Үндсэн зарчим:
backend ямар мэдрэгч байгааг **мэдэхгүй** — төхөөрөмжүүд `capabilities[]` зарлагаддаг бөгөөд
та шинэ мэдрэгч/шинэ загвар нэмэхэд **схем өөрчлөх шаардлагагүй**.

Дэлгэрүүлсэн зохицуулалт: [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md)

---

## Бүтэц

```
smart-monitor-v1/
├── firmware/smart_monitor_v1/   ESP32 sketch (non-blocking, capability-based)
├── server/                      Node/Express/Mongoose API + Socket.IO  (P1-P6, P10)
│   └── src/utils/roles.js       the one role vocabulary (RBAC source of truth)
├── web/                         React dashboard                        (P8)
├── scripts/                     seed, sign-request, smoke-test         (P9)
├── docs/architecture/           ARCHITECTURE.md + diagrams/
└── .gitignore
```

## Ажиллуулах (local development)

**1. MongoDB** (local install; `mongod` 8.x tested)

```bash
mongod --dbpath ./data/db
```

**2. API**

```bash
cd server
npm install
cp .env.example .env      # дараа нь нууцлалуудаа үүсгэ
npm run seed              # демо хэрэглэгч + төхөөрөмж + 24ц мэдээлэл
npm run dev               # http://localhost:5000
```

**3. Web**

```bash
cd web
npm install
npm run dev               # http://localhost:5173
```

Демо нэвтрэлт: `owner@example.com` / `Str0ng!Passw0rd`

## Хоёр environment хувьсагч заавал хэрэгтэй

Production дээр хоёр утгыг **яг зөв** тавьхгүй бол апп ажиллахгүй:

| Хувьсагч | Дээр байх газар | Жишээ |
|---|---|---|
| `VITE_API_BASE_URL` | Vercel env | `https://smart-monitor-7rza.onrender.com` |
| `CLIENT_URL` | Render env | `https://smart-monitor-v1.vercel.app` |

Хоёр дахь алдаа нь **үнэхээр нууц** — `VITE_API_BASE_URL` дээрээ **trailing space**
орсон бол хүсэлт `https://host%20/api/v1/...` болж `ERR_NAME_NOT_RESOLVED` гарна,
харин `CLIENT_URL` тохируулаагүй бол бүх хүсэлт `blocked by CORS policy` болно.

Хоёр түлхүүр дүрэм:
- **Trailing space/slash байхгүй** — яг `scheme+host`, үсгээр дуусна
- **`CLIENT_URL` нь таны Vercel-ийн үндсэн хаяг**, `web-<hash>-...vercel.app` биш
  (тэр нь deploy бүрт солигддог тэгвэл хэзээ ч хуусаж, зогсоно)

Алдаа гарвал Render лог дахь `cors rejected origin - add it to CLIENT_URL`
гэсэн мөрөөс яг аль origin хоригдсон болохыг шууд харна.

## Роли (RBAC)

Дөрвөн role байна; бүгд **зөвхөн сервер дээр** хүчин төгөлдөр (үүсгэсэн олонхон
`server/src/utils/roles.js` дахь ганц толь бичгийг хувааж авдаг):

| Role | Хэрэглэгчийн хувьд | Төхөөрөмжийн хувьд |
|---|---|---|
| `owner` | Өөрийн төхөөрөмжүүдийг бүрэн удирдана | өөрийнх нь бүх үйлдэл |
| `manager` | Хэрэглэгч үүсгэхгүй | бүх төхөөрөмжийг **уншина/тохируулна**, гэхдээ revoke/delete хийхгүй |
| `admin` | Хэрэглэгч үүсгэнэ, role өгнө | бүх төхөөрөмж дээр бүх үйлдэл |
| `viewer` | зөвхөн унших | уншихад хязгаарлагдсан |

**Эхний admin-ыг хэрхэн үүсгэх вэ?** Өөрөөр тэрдүүлбэр эрхээс гадна үргэлж
`owner` байдаг (privilege escalation-ыг хагасах дүрэм). Иймээс `server/.env` дээр
`BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` (мөн `MANAGER`, `OWNER`)
гэж бичээд серверээ асаана. API **boot бүрд** эдгээр аккаунтыг үүсгэх/хэрэглэгчийн
role-ыг засах бөгөөд давхар хийхэд огт асуудал үүсэхгүй (нууцлал хэвээр үлдэнэ).
Дараа нь бүх цаашдын аккаунтыг **Dashboard → Users** хуудасаас бүрдэж болно.

## Тест

```bash
cd server && npm test      # 9 suites, 103 tests (Jest + mongodb-memory-server)
cd web && npm run build    # production build
node scripts/smoke-test.js # иж бүрэн HTTP аюулгүй байдлын шалгалт (API ажиллаж байх ёстой)
```

## Аюулгүй байдлын үндсэн дүрмүүд

- Төхөөрөмж **зөвхөн HMAC**-аар бичнэ; `deviceId` ганцаараа ямар ч бичлэгийг зөвшөөрдөггүй.
- Хэрэглэгчийн JWT **хэзээ ч** telemetry бичихэд ашиглагдахгүй; зөвшөөрөл frontend-ээс итгэлгүй.
- MongoDB төхөөрөмжөөс **хэзээ ч** хандахгүй; зөвхөн API-аас.
- Wi-Fi тасарсан ч мэдээлэл алдагдахгүй (MicroSD буфер + at-least-once синхрончлол).
- Мэдрэгч амжилтгүй бол **0 утга бичдэггүй** — уншлагыг хасч, quality тэмдэглэнэ.
- `eco2` (CCS811 тооцоолсон) **хэзээ ч** NDIR `co2` байдлаар харуулагдахгүй.

## Замын зураглал (§23)

| Фаз | Зорилго | Төлөв |
|---|---|---|
| P0–P6 | Архитектур, auth, device identity, telemetry, realtime, alerts | ✅ |
| P7 | Firmware v1 (мэдрэгч, SD буфер, provisioning, uploader) | ✅ код бэлэн, төхөөрөмж дээр шалгах үлдсэн |
| P8 | Web dashboard (auth, devices, live charts, history) | ✅ |
| P9 | DevOps: docker-compose, CI, docs | 🟡 seed/scripts байна, docker/CI үлдэгдэл |
| P10 | Hardening (rate limit, redaction, range validation) | ✅ тестүүд ногоон |

## ESP32 firmware шарах (P7)

ESP32 хэзээ ч MongoDB рүү **шууд холбогддоггүй**. Зам нь:

```
ESP32 -> Wi-Fi -> POST /provisioning/* + /telemetry (HMAC) -> API -> MongoDB Atlas -> dashboard
```

Таны өгсөн `MONGO_URI` зөвхөн `server/.env` дотор байна (коммитлагдахгүй!):

```bash
# server/.env
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/uhaalag_monitor_v1
```

### 1. Холболт

```bash
pip install platformio
cd firmware/smart_monitor_v1
pio run -t upload        # USB-ээр шарах
pio device monitor       # 115200 baud console
```

### 2. Wi-Fi холбох

Эхний асалтаар `SmartMonitor-XXXXXX` нэртэй нээлттэй AP гарна —
утасаараа холбогдоод `http://192.168.4.1` нээж гэрийн Wi-Fi + серверийн
URL (`https://таны-сервер` эсвэл `http://192.168.1.90:5000`) бичээд
Save дарна. Төхөөрөмж өөрөө `register -> exchange` хийж `deviceId` +
нууц авч, NVS-д хадгална; console дээр **claim code** хэвлэгдэнэ.

### 3. Claim + харах

Dashboard дээр Login -> Claim товч -> claim code бичих -> төхөөрөмж
жагсаалтад гарна -> дэлгэрэнгүй хуудаснаас live chart + түүх харагдана.
`type status` (serial) гэж бичвэл `pending=` буфер тоолуур харагдана.

Пин зураглал: `config.h` (DHT11=GPIO4, A3144=GPIO16, I2C=21/22,
SD: CS=5 SCK=18 MISO=19 MOSI=23, BOOT товч=GPIO0, LED=GPIO2).
