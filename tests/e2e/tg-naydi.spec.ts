import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { encodeWindows1251 } from '../helpers/cp1251';

test.describe('TG Naydi End-to-End Browser Verification', () => {
  test('uploads dirty Windows-1251 CSV, pauses, survives F5 reload, completes, exports Excel BOM CSV, and deletes PII', async ({
    page,
  }) => {
    await page.goto('/');

    // Honest mode badge must be visible
    await expect(page.getByTestId('mode-badge')).toContainText('ДЕМО-РЕЖИМ (SANDBOX)');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Подготовь базу к рассылке в Telegram'
    );

    // Build a real Windows-1251 Russian Excel CSV with ; delimiter, duplicates, mixed formats, and invalid row
    const dirtyCsv = [
      'Имя;Телефон;Город',
      'Beze Cakes;8 (905) 111-45-67;Казань',
      'SpeakUp Kids;+7 963 222-65-43;Казань',
      'Mimi Nails;+7 921 333-12-34;Казань',
      'Kazan Coffee;89994442233;Казань',
      'Volga Flowers;+7 906 555-44-55;Казань',
      'Дубль Beze;+79051114567;Казань',
      'Битая строка;не-телефон;Казань',
      'Kazan Pilates;+7 917 601-11-22;Казань',
      'ChakChak Lab;+7 917 602-33-44;Казань',
      'Tatar Travel;8 917 603-55-66;Казань',
      'Art Studio;9176047788;Казань',
      'Closed Contact;+7 917 615-10-10;Казань',
    ].join('\r\n');

    const tmpFile = path.join(process.cwd(), '.data', 'e2e-dirty-cp1251.csv');
    await fs.mkdir(path.dirname(tmpFile), { recursive: true });
    await fs.writeFile(tmpFile, encodeWindows1251(dirtyCsv));

    // Set batchSize=2 and pauseMs=600 so we can reliably pause mid-run
    await page.locator('input[type="number"]').first().fill('2');
    await page.locator('input[type="number"]').nth(1).fill('600');

    await page.getByTestId('csv-file-input').setInputFiles(tmpFile);

    // Verify client-side CP1251 decoding and deduplication summary
    const summary = page.getByTestId('validation-summary');
    await expect(summary).toContainText('windows-1251');
    await expect(summary).toContainText('10'); // 10 unique valid phones (12 rows - 1 dup - 1 invalid)

    // Start check
    await page.getByTestId('start-check-btn').click();
    await expect(page.getByTestId('monitor-filename')).toContainText('e2e-dirty-cp1251.csv');

    // Wait for at least 1 batch to complete, then click Pause
    await expect
      .poll(async () => {
        const txt = await page.getByTestId('progress-counter').textContent();
        const match = txt?.match(/(\d+)\s+из\s+10/);
        return match ? Number(match[1]) : 0;
      })
      .toBeGreaterThanOrEqual(2);

    await page.getByTestId('pause-job-btn').click();
    await expect(page.getByTestId('job-status-badge')).toContainText('на паузе');

    const pausedProgressText = await page.getByTestId('progress-counter').textContent();
    expect(pausedProgressText).toMatch(/[2-8]\s+из\s+10/);

    // Verify masked phone is shown and raw phone is NOT leaked on screen
    const monitorText = await page.getByTestId('live-monitor-card').textContent();
    expect(monitorText).toContain('+7 905 •••-45-67');
    expect(monitorText).not.toContain('+79051114567');

    // Reload page (F5) and verify server JobStore restored paused progress accurately
    await page.reload();
    await expect(page.getByTestId('job-status-badge')).toContainText('на паузе');
    await expect(page.getByTestId('progress-counter')).toHaveText(pausedProgressText!);

    // Resume and wait for completion
    await page.getByTestId('resume-job-btn').click();
    await expect(page.getByTestId('job-status-badge')).toContainText('готово', {
      timeout: 25_000,
    });
    await expect(page.getByTestId('progress-counter')).toHaveText('10 из 10');

    // Verify counter reconciliation invariant in UI
    const totalFound = Number(await page.getByTestId('stat-found-total').textContent());
    const personFound = Number(await page.getByTestId('stat-found-person').textContent());
    const channelFound = Number(await page.getByTestId('stat-found-channel').textContent());
    expect(totalFound).toBe(personFound + channelFound);
    expect(totalFound).toBe(9);
    expect(personFound).toBe(6);
    expect(channelFound).toBe(3);

    // Download result.csv and verify UTF-8 BOM, Russian labels, SANDBOX stamp, and exact row count
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-csv-btn').click(),
    ]);
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const rawCsvBytes = await fs.readFile(downloadedPath!);
    expect([rawCsvBytes[0], rawCsvBytes[1], rawCsvBytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = rawCsvBytes.toString('utf-8');
    expect(csvText).toContain('+79051114567;@beze_cakes_kzn;person;человек;found;');
    expect(csvText).toContain('+79632226543;@speakup_kids_kzn;channel;канал;found;');
    expect(csvText).toContain('SANDBOX');

    // Delete PII immediately
    await page.getByTestId('delete-job-btn').click();
    await expect(page.getByTestId('results-card')).toHaveCount(0);
    await expect(page.getByTestId('monitor-filename')).toHaveText('база.csv');
  });

  test('runs 1-click Kazan sample to 19 found (14 person + 5 channel) and captures visual snapshot', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 960 });
    await page.goto('/');

    // Speed up sandbox pause for fast test run
    await page.locator('input[type="number"]').first().fill('10');
    await page.locator('input[type="number"]').nth(1).fill('150');

    await page.getByTestId('load-sample-btn').click();
    await expect(page.getByTestId('validation-summary')).toContainText('22');

    await page.getByTestId('start-check-btn').click();
    await expect(page.getByTestId('job-status-badge')).toContainText('готово', {
      timeout: 20_000,
    });

    await expect(page.getByTestId('stat-found-total')).toHaveText('19');
    await expect(page.getByTestId('stat-found-person')).toHaveText('14');
    await expect(page.getByTestId('stat-found-channel')).toHaveText('5');

    // Capture full-page screenshot for human/visual inspection against ref-01 & ref-02
    const screenshotPath = path.join(process.cwd(), '.data', 'e2e-visual-snapshot.png');
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
  });
});
