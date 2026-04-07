#!/usr/bin/env python3
"""
One-time script: Convert prices_normalized.parquet to SQLite for fast Node.js querying.
Usage: python3 script/convert_parquet_to_sqlite.py
"""

import os
import sys
import time
import sqlite3
import pyarrow.parquet as pq

PARQUET_PATH = os.path.expanduser("~/Downloads/prices_normalized.parquet")
SQLITE_PATH = os.path.join(os.path.dirname(__file__), "..", "server", "data", "prices.sqlite")

def main():
    if not os.path.exists(PARQUET_PATH):
        print(f"ERROR: Parquet file not found at {PARQUET_PATH}")
        sys.exit(1)

    # Ensure output directory exists
    os.makedirs(os.path.dirname(SQLITE_PATH), exist_ok=True)

    # Remove existing DB if present
    if os.path.exists(SQLITE_PATH):
        print(f"Removing existing SQLite DB at {SQLITE_PATH}")
        os.remove(SQLITE_PATH)

    print(f"Reading parquet file: {PARQUET_PATH}")
    start = time.time()

    parquet_file = pq.ParquetFile(PARQUET_PATH)
    total_rows = parquet_file.metadata.num_rows
    print(f"Total rows in parquet: {total_rows:,}")
    print(f"Schema: {parquet_file.schema.names}")

    conn = sqlite3.connect(SQLITE_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")  # Speed up bulk insert
    conn.execute("PRAGMA cache_size=-2000000")  # 2GB cache

    # Create prices table
    conn.execute("""
        CREATE TABLE prices (
            ticker TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            adj_close REAL,
            adj_open REAL,
            adj_high REAL,
            adj_low REAL,
            adj_volume INTEGER,
            div_cash REAL,
            split_factor REAL,
            source TEXT
        )
    """)

    # Read and insert in row group batches
    inserted = 0
    num_row_groups = parquet_file.metadata.num_row_groups
    print(f"Processing {num_row_groups} row groups...")

    for i in range(num_row_groups):
        table = parquet_file.read_row_group(i)
        df = table.to_pandas()

        # Rename columns to match our schema
        col_map = {
            'ticker': 'ticker', 'date': 'date',
            'open': 'open', 'high': 'high', 'low': 'low', 'close': 'close',
            'volume': 'volume',
            'adjClose': 'adj_close', 'adjOpen': 'adj_open',
            'adjHigh': 'adj_high', 'adjLow': 'adj_low',
            'adjVolume': 'adj_volume',
            'divCash': 'div_cash', 'splitFactor': 'split_factor',
            'source': 'source'
        }

        # Only rename columns that exist
        rename = {k: v for k, v in col_map.items() if k in df.columns}
        df = df.rename(columns=rename)

        # Convert date to string if it's datetime
        if hasattr(df['date'].dtype, 'tz') or str(df['date'].dtype).startswith('datetime'):
            df['date'] = df['date'].dt.strftime('%Y-%m-%d')
        else:
            df['date'] = df['date'].astype(str)

        # Select only the columns we want
        target_cols = ['ticker', 'date', 'open', 'high', 'low', 'close', 'volume',
                       'adj_close', 'adj_open', 'adj_high', 'adj_low', 'adj_volume',
                       'div_cash', 'split_factor', 'source']
        available_cols = [c for c in target_cols if c in df.columns]
        df = df[available_cols]

        # Insert into SQLite in small chunks to avoid "too many SQL variables"
        chunk_size = 5000
        for start_idx in range(0, len(df), chunk_size):
            chunk = df.iloc[start_idx:start_idx + chunk_size]
            chunk.to_sql('prices', conn, if_exists='append', index=False)
        inserted += len(df)

        elapsed = time.time() - start
        pct = (inserted / total_rows) * 100
        rate = inserted / elapsed if elapsed > 0 else 0
        print(f"  Row group {i+1}/{num_row_groups}: {inserted:,} rows ({pct:.1f}%) — {rate:,.0f} rows/sec")

    print(f"\nAll data inserted: {inserted:,} rows in {time.time() - start:.1f}s")
    print("Creating indexes (this may take a minute)...")

    idx_start = time.time()
    conn.execute("CREATE INDEX idx_ticker_date ON prices(ticker, date)")
    print(f"  idx_ticker_date created in {time.time() - idx_start:.1f}s")

    idx_start = time.time()
    conn.execute("CREATE INDEX idx_date ON prices(date)")
    print(f"  idx_date created in {time.time() - idx_start:.1f}s")

    # Create tickers lookup table
    conn.execute("CREATE TABLE tickers AS SELECT DISTINCT ticker FROM prices ORDER BY ticker")
    conn.execute("CREATE INDEX idx_tickers_ticker ON tickers(ticker)")
    ticker_count = conn.execute("SELECT COUNT(*) FROM tickers").fetchone()[0]
    print(f"  tickers table: {ticker_count:,} unique tickers")

    # Get date range
    date_range = conn.execute("SELECT MIN(date), MAX(date) FROM prices").fetchone()
    print(f"  Date range: {date_range[0]} to {date_range[1]}")

    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("ANALYZE")
    conn.commit()
    conn.close()

    file_size = os.path.getsize(SQLITE_PATH) / (1024 ** 3)
    total_time = time.time() - start
    print(f"\nDone! SQLite DB: {SQLITE_PATH}")
    print(f"File size: {file_size:.2f} GB")
    print(f"Total time: {total_time:.1f}s")
    print(f"Tickers: {ticker_count:,}")
    print(f"Rows: {inserted:,}")

if __name__ == "__main__":
    main()
