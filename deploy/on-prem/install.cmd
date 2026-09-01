@echo off
rem Chay install.ps1 ma khong bi chan boi Execution Policy mac dinh cua Windows
rem ("...cannot be loaded because running scripts is disabled on this system").
rem File .cmd khong bi Execution Policy kiem soat nen chay/double-click duoc luon.
rem Moi tham so truyen vao install.cmd (vi du -Version 2026.09.05 -SkipTenantCreation)
rem duoc chuyen nguyen ven sang install.ps1 qua %*.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
