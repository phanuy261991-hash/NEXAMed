-- Yêu cầu cấp hàng (#298): ép RLS cho cả chủ bảng, đúng chuẩn các bảng khác (test rls-coverage).
ALTER TABLE "stock_request" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_request_line" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_request_event" FORCE ROW LEVEL SECURITY;
