#!/usr/bin/env python3
"""
FinanceDataReader 기반 국내 주식 시장 데이터 수집 스크립트.

기능:
- 최신 시가총액(Marcap): KRX(FinanceDataReader) 우선, 실패 시 yfinance 발행주식수 × 일봉 최신 종가로 계산
- 최근 1년 일봉 수집 후 최대 250거래일로 제한
- data/market/{ticker}.json 저장

설치:
    pip install finance-datareader pandas
    pip install yfinance   # 시총 fallback용(선택)
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import FinanceDataReader as fdr
import pandas as pd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="국내 주식 시장 데이터(시가총액/일봉) 수집",
    )
    parser.add_argument(
        "stock_code",
        help="국내 종목코드 (예: 005930)",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="출력 JSON 경로 (기본: data/market/{ticker}.json)",
    )
    parser.add_argument(
        "--max-days",
        type=int,
        default=250,
        help="저장할 최대 거래일 수 (기본: 250)",
    )
    parser.add_argument(
        "--history-years",
        type=int,
        default=10,
        help="연도말 시총 추정을 위한 가격 히스토리 연수 (기본: 10)",
    )
    return parser.parse_args()


def normalize_code(code: str) -> str:
    # KRX 코드는 6자리로 맞추는 것이 안전하다.
    stripped = code.strip()
    if stripped.isdigit():
        return stripped.zfill(6)
    return stripped


def get_market_cap(stock_code: str) -> int | None:
    """KRX 시가총액 조회. KRX가 HTML/빈 응답을 주면 JSONDecodeError 등으로 실패할 수 있음 → None 반환."""
    try:
        listing = fdr.StockListing("KRX")
        if listing is None or listing.empty:
            return None
        row = listing.loc[listing["Code"] == stock_code]
        if row.empty:
            return None
        marcap = row.iloc[0].get("Marcap")
        if pd.isna(marcap):
            return None
        return int(marcap)
    except Exception:
        return None


def get_shares_outstanding_yfinance(stock_code: str) -> float | None:
    """yfinance에서 발행주식수만 조회. 한국 종목은 .KS(코스피)/.KQ(코스닥). 실패 시 None. (yfinance 미설치 시 None)"""
    try:
        import yfinance as yf
    except ImportError:
        return None
    for suffix in (".KS", ".KQ"):
        try:
            t = yf.Ticker(f"{stock_code}{suffix}")
            info = t.info or {}
            out = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding")
            if out is None:
                continue
            v = float(out)
            if v <= 0 or pd.isna(v):
                continue
            return v
        except Exception:
            continue
    return None


def get_price_history(stock_code: str, history_years: int) -> pd.DataFrame:
    """일봉 조회. KRX/네트워크 오류 시 빈 DataFrame 반환."""
    try:
        end = datetime.today()
        years = history_years if history_years > 0 else 10
        start = end - timedelta(days=365 * years)
        df = fdr.DataReader(stock_code, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
        if df is None or df.empty:
            return pd.DataFrame()
        return df.copy()
    except Exception:
        return pd.DataFrame()


def get_daily_chart_from_df(df: pd.DataFrame, max_days: int) -> list[dict[str, Any]]:
    if df is None or df.empty:
        return []

    end = datetime.today()

    # 최근 데이터 기준으로 최대 250거래일 제한
    df = df.tail(max_days).copy()

    chart: list[dict[str, Any]] = []
    for idx, row in df.iterrows():
        chart.append(
            {
                "date": idx.strftime("%Y-%m-%d"),
                "open": float(row["Open"]) if not pd.isna(row["Open"]) else None,
                "high": float(row["High"]) if not pd.isna(row["High"]) else None,
                "low": float(row["Low"]) if not pd.isna(row["Low"]) else None,
                "close": float(row["Close"]) if not pd.isna(row["Close"]) else None,
                "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else None,
            }
        )
    return chart


def build_year_end_market_caps(
    price_df: pd.DataFrame,
    market_cap: int | None,
) -> tuple[float | None, dict[str, int], dict[str, float], dict[str, float]]:
    if price_df is None or price_df.empty:
        return None, {}, {}, {}
    if "Close" not in price_df.columns:
        return None, {}, {}, {}
    valid_df = price_df.loc[~price_df["Close"].isna()].copy()
    if valid_df.empty:
        return None, {}, {}, {}
    latest_close = float(valid_df.iloc[-1]["Close"])
    if latest_close <= 0 or market_cap is None or market_cap <= 0:
        return None, {}, {}, {}

    est_shares = float(market_cap) / latest_close
    year_last_close: dict[str, float] = {}
    for idx, row in valid_df.iterrows():
        y = idx.strftime("%Y")
        year_last_close[y] = float(row["Close"])

    year_end_market_caps: dict[str, int] = {}
    year_end_estimated_shares: dict[str, float] = {}
    for y, close in year_last_close.items():
        if close > 0:
            year_end_market_caps[y] = int(round(est_shares * close))
            year_end_estimated_shares[y] = est_shares

    return est_shares, year_end_market_caps, year_last_close, year_end_estimated_shares


def main() -> None:
    args = parse_args()
    stock_code = normalize_code(args.stock_code)

    market_cap = get_market_cap(stock_code)
    market_cap_source = "krx" if market_cap is not None else "missing"
    shares_source = None
    price_df = get_price_history(stock_code, args.history_years)
    daily_chart = get_daily_chart_from_df(price_df, args.max_days)

    # KRX 시총 실패 시: yfinance 발행주식수 × 일봉 최신 종가로 계산
    if market_cap is None and price_df is not None and not price_df.empty and "Close" in price_df.columns:
        valid_df = price_df.loc[~price_df["Close"].isna()]
        if not valid_df.empty:
            latest_close = float(valid_df.iloc[-1]["Close"])
            if latest_close > 0:
                shares = get_shares_outstanding_yfinance(stock_code)
                if shares is not None and shares > 0:
                    market_cap = int(round(latest_close * shares))
                    market_cap_source = "yfinance_x_close"
                    shares_source = "yfinance"

    est_shares, year_end_market_caps, year_end_close_prices, year_end_estimated_shares = build_year_end_market_caps(price_df, market_cap)

    output_data = {
        "stock_code": stock_code,
        "market_cap": market_cap,
        "market_cap_source": market_cap_source,
        "shares_source": shares_source,
        "estimated_shares_outstanding": est_shares,
        "year_end_estimated_shares": year_end_estimated_shares,
        "year_end_market_caps": year_end_market_caps,
        "year_end_close_prices": year_end_close_prices,
        "daily_chart": daily_chart,
    }

    output_path = Path(args.output) if args.output else Path("data") / "market" / f"{stock_code}.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output_data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Saved: {output_path}")
    print(f"stock_code={stock_code}, market_cap={market_cap}, daily_rows={len(daily_chart)}")


if __name__ == "__main__":
    main()
