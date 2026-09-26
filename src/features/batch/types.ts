export const FUEL_OPTIONS = ["92号汽油", "95号汽油", "98号汽油", "柴油"] as const;

export type IssueCode =
  | "FORMAT"
  | "STATION_EMPTY"
  | "FUEL_UNKNOWN"
  | "PRICE_NUMBER"
  | "PRICE_DECIMAL"
  | "PRICE_RANGE"
  | "DATE_FORMAT"
  | "DATE_PAST"
  | "DUPLICATE";

export interface RowIssue {
  code: IssueCode;
  message: string;
}

export interface PriceVersion {
  id: string;
  kind: "frozen" | "supplement";
  price: number;
  effectiveDate: string;
  reason: string;
  createdAt: string;
}

export interface BatchRow {
  id: string;
  lineNo: number;
  station: string;
  fuel: string;
  priceText: string;
  price: number | null;
  effectiveDate: string;
  formatIssue: RowIssue | null;
  issues: RowIssue[];
  versions: PriceVersion[];
}

export type BatchStatus = "draft" | "submitted" | "frozen";

export interface PriceBatch {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: string;
  submittedAt: string | null;
  frozenAt: string | null;
  rows: BatchRow[];
}

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  draft: "编辑中",
  submitted: "待审核",
  frozen: "已冻结"
};
