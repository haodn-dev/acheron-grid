# Acheron Grid Engine

> Spreadsheet UX. Data-grid semantics. Canvas performance.

Acheron Grid Engine hướng đến một thư viện Data Grid viết bằng TypeScript thuần, sử dụng Canvas để hiển thị dữ liệu và cung cấp trải nghiệm chọn, điều hướng, chỉnh sửa giống spreadsheet. Core được thiết kế độc lập framework, với định hướng sử dụng trong vanilla JavaScript, React và Vue.

## Trạng thái hiện tại

Dự án đang ở giai đoạn khởi tạo repository. Hiện chỉ có cấu trúc thư mục và tài liệu giới thiệu; chưa có engine chạy được, public API, adapter, build tooling hay benchmark.

Chưa có package để cài đặt hoặc ví dụ để chạy. Hướng dẫn cài đặt và sử dụng sẽ được bổ sung khi có triển khai thực tế.

## Định hướng thiết kế

Các nội dung dưới đây là định hướng, chưa phải khả năng đã triển khai:

- Canvas hiển thị dữ liệu; DOM phục vụ editor, menu, overlay và accessibility.
- Virtualization theo hàng và cột để giới hạn việc render trong vùng nhìn thấy.
- Mô hình dữ liệu dựa trên `rowId`, `columnKey` và value; hỗ trợ DataSource local và remote.
- Cập nhật từng phần và batch updates để hạn chế render lại không cần thiết.
- Core độc lập framework; React và Vue tích hợp qua adapter.

## Phạm vi dự kiến của V1

- Selection, multi-range và điều hướng bằng bàn phím.
- Inline editing, clipboard và undo/redo.
- Resize hàng/cột, frozen panes và virtualization.
- Custom renderer/editor, themes và API mở rộng.
- Local/async DataSource, vanilla API và React/Vue adapters.

Formula engine, charts, pivot tables, workbook/multiple sheets, tương thích tính toán Excel và collaboration thời gian thực nằm ngoài phạm vi V1.

Hiệu năng là mục tiêu thiết kế; hiện chưa có kết quả benchmark để công bố khả năng xử lý dữ liệu hoặc tốc độ render.

## Cấu trúc repository

- [`packages/core/`](packages/core/README.md): vị trí dự kiến cho core TypeScript; hiện chưa có implementation.
- Adapters, examples, themes và benchmarks sẽ được bổ sung khi triển khai.

Laravel không phải dependency của engine.

## License

Dự án hướng đến mã nguồn mở nhưng chưa chọn license và chưa có file `LICENSE`. Repository công khai không thay thế cho giấy phép sử dụng hoặc phân phối mã nguồn. Thông tin license sẽ được cập nhật trước khi phát hành thư viện.
