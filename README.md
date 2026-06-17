# ReleaseHub Server

ReleaseHub Server là một server quản lý phiên bản cập nhật Over-The-Air (OTA) gọn nhẹ cho ứng dụng React Native. Nó hoạt động như một hệ thống tự lưu trữ (self-hosted) thay thế cho Microsoft CodePush.

---

## Tính năng chính

- **Xác thực đa người dùng**: Hỗ trợ đăng nhập bằng tài khoản và phân quyền dựa trên Access Token.
- **Phân quyền ứng dụng (App Permission)**: Giới hạn quyền deploy ứng dụng. Người đầu tiên deploy một ứng dụng (hoặc tài khoản Admin) sẽ có quyền sở hữu ứng dụng đó.
- **Phân tích Semver động**: So khớp phiên bản nhị phân của ứng dụng khách (client) với phạm vi phiên bản chỉ định trên Server (ví dụ: `^1.0.0`, `1.0.x`) bằng thư viện `semver`.
- **Tránh trùng lặp file (Deduplication)**: Sử dụng mã băm SHA256 của file zip để lưu trữ. Nếu bundle trùng lặp, server sẽ tái sử dụng và không lưu trữ lại.
- **Giao diện Dashboard**: Phục vụ các trang tĩnh từ thư mục `public` cung cấp số liệu thống kê trực quan về ứng dụng, nền tảng, số bản release và lịch sử phát hành.
- **SQLite Database**: Lưu trữ dữ liệu nhanh chóng và bền vững mà không cần setup hệ quản trị cơ sở dữ liệu cồng kềnh.

---

## Cấu trúc thư mục

```text
server/
├── src/
│   ├── index.ts                 # Điểm khởi đầu của ứng dụng Express
│   ├── database.ts              # Khởi tạo SQLite và các câu lệnh tương tác DB
│   ├── create-user.ts           # Script chạy bằng CLI để tạo user mới
│   ├── delete-user.ts           # Script chạy bằng CLI để xóa user
│   ├── controllers/
│   │   ├── releaseController.ts  # Logic nghiệp vụ check update, deploy & lịch sử release
│   │   └── dashboardController.ts# Logic tổng hợp thông tin thống kê cho Dashboard
│   └── utils/
│       └── auth.ts              # Mã hóa mật khẩu (salt, pbkdf2) và sinh CLI token
├── public/                      # Chứa mã nguồn frontend Dashboard (nếu có)
├── uploads/                     # Nơi chứa các tệp tin ZIP OTA đã được upload
├── .env.dist                    # File cấu hình mẫu môi trường
├── tsconfig.json                # Cấu hình TypeScript compiler
└── package.json                 # Khai báo thư viện phụ thuộc và các scripts
```

---

## Hướng dẫn cài đặt & Chạy dưới local

### 1. Cài đặt các thư viện phụ thuộc
Di chuyển vào thư mục `server` và chạy lệnh cài đặt:
```bash
npm install
```

### 2. Cấu hình biến môi trường
Tạo file `.env` từ file mẫu `.env.dist`:
```bash
cp .env.dist .env
```
Điều chỉnh lại các cấu hình bên trong `.env` nếu cần thiết (ví dụ: cổng chạy `PORT` hoặc mã khóa bí mật `API_KEY`).

### 3. Tạo tài khoản quản trị/người dùng đầu tiên
Để có tài khoản đăng nhập trên CLI hoặc Dashboard, hãy tạo user bằng script sau:
```bash
npm run create-user -- --username <tên_đăng_nhập> --password <mật_khẩu> --role <admin|user>
```
*Ví dụ:*
```bash
npm run create-user -- --username admin --password mysecretadminpass --role admin
```
*Lưu ý:* Khi tài khoản được tạo thành công, một Access Token duy nhất sẽ được tự động tạo cho người dùng này trong SQLite (`database.sqlite`).

### 4. Xóa tài khoản người dùng
Nếu cần xóa một tài khoản khỏi hệ thống:
```bash
npm run delete-user -- --username <tên_đăng_nhập>
```
*Ví dụ:*
```bash
npm run delete-user -- --username admin
```

### 5. Khởi chạy Server
* **Chế độ phát triển (Development):**
  ```bash
  npm run dev
  ```
  Server mặc định chạy tại địa chỉ `http://localhost:4000`.

* **Chế độ production (Build & Start):**
  ```bash
  npm run build
  npm start
  ```

---

## Tài liệu API (API Endpoints)

Tất cả các API yêu cầu xác thực phải gửi kèm Header:
`Authorization: Bearer <cli_access_token>`

### 1. Xác thực & Tài khoản

#### Đăng nhập hệ thống (`POST /api/login`)
- **Mục đích**: Xác thực người dùng và trả về Token. (Endpoint công khai)
- **Body (JSON)**:
  ```json
  {
    "username": "admin",
    "password": "mysecretadminpass"
  }
  ```
- **Response**: Trả về token xác thực và thông tin cơ bản của user.

#### Xem thông tin cá nhân (`GET /api/me`)
- **Mục đích**: Lấy thông tin user hiện tại và kiểm tra token hợp lệ.
- **Yêu cầu**: Cần Token.

---

### 2. Quản lý Release & OTA

#### Deploy bản cập nhật mới (`POST /api/deploy`)
- **Mục đích**: Cho phép CLI upload và phân phối tệp cập nhật OTA.
- **Yêu cầu**: Cần Token. Gửi dưới dạng `multipart/form-data`.
- **Fields**:
  - `appName` (string): Tên ứng dụng (ví dụ: `MyAwesomeApp`).
  - `platform` (string): Hệ điều hành (`ios` hoặc `android`).
  - `deploymentName` (string): Môi trường deploy (`Staging` hoặc `Production`).
  - `appVersion` (string): Phiên bản nhị phân đích của ứng dụng, hỗ trợ dải semver (ví dụ: `1.0.0`, `^1.2.0`).
  - `description` (string, optional): Nội dung mô tả bản cập nhật.
  - `isMandatory` (string/boolean, optional): Bắt buộc người dùng cập nhật ngay hay không (`true` hoặc `false`).
  - `package` (file): Tệp ZIP chứa bundle của ứng dụng React Native.

#### Lấy lịch sử Release (`GET /api/releases`)
- **Mục đích**: Trả về danh sách release của một ứng dụng phục vụ CLI.
- **Yêu cầu**: Cần Token.
- **Query Params**:
  - `appName`, `platform`, `deploymentName`

#### Kiểm tra bản cập nhật (`GET /api/check-update`)
- **Mục đích**: API công khai dùng cho React Native SDK để kiểm tra xem thiết bị có bản cập nhật OTA mới hay không. (Endpoint công khai)
- **Query Params**:
  - `appName` (string)
  - `platform` (string)
  - `deploymentName` (string)
  - `appVersion` (string - Phiên bản ứng dụng gốc trên máy client, ví dụ: `1.0.0`)
  - `packageHash` (string - Mã băm bản bundle hiện tại trên máy client)
- **Response**:
  - Nếu đã là bản mới nhất: `{"updateInfo": {"update": false}}`
  - Nếu có bản cập nhật mới phù hợp điều kiện:
    ```json
    {
      "updateInfo": {
        "update": true,
        "downloadUrl": "http://localhost:4000/uploads/c5e9...zip",
        "packageHash": "c5e9...",
        "isMandatory": true,
        "description": "Fix bug đăng nhập",
        "appVersion": "^1.0.0",
        "packageSize": 2561922
      }
    }
    ```

---

### 3. Dashboard & Hệ thống

#### Thông tin thống kê Dashboard (`GET /api/dashboard-summary`)
- **Mục đích**: Lấy thông tin thống kê số lượng release, danh sách app đang được quản lý, các bản cập nhật gần đây để vẽ dashboard.
- **Yêu cầu**: Cần Token.

#### Health check (`GET /health`)
- **Mục đích**: Kiểm tra tình trạng hoạt động của Server. (Endpoint công khai)
