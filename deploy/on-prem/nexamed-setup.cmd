@echo off
rem Mo TRINH CAI DAT/NANG CAP NEXAMed (docs/DECISIONS.md #238). Double-click hoac chay trong cua so lenh.
rem File .cmd khong bi Execution Policy kiem soat nen chay duoc luon; moi tham so (vi du -Version 0.9.0 -Port 8091)
rem duoc chuyen nguyen ven sang nexamed-setup.ps1 qua %*.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0nexamed-setup.ps1" %*
if errorlevel 1 pause
