# Unity Slot Widget

[English](README.md)

[unity-slot](https://github.com/cyKim0115/unity-slot)과 함께 쓰는 작은 데스크톱 위젯입니다. Unity 클론(슬롯)마다 에디터가 열렸는지·여는 중인지·닫혔는지, 누가 임대했는지, 에디터 트리가 메모리를 얼마나 쓰는지, 이 PC에만 있는 git 작업이 무엇인지 한눈에 보여 줍니다.

위젯은 **읽기 전용**입니다. 슬롯을 열거나 닫거나 임대하지 않습니다. 판단은 모두 `unity-slot dashboard -Json`이 합니다.

> 만드는 중입니다. 스크린샷·도식·설치 파일은 첫 릴리스 때 넣습니다.

## 필요한 것

- Windows 10 또는 11 (WebView2 런타임, Windows 11에는 기본 포함)
- `dashboard` 명령이 있는 unity-slot (스키마 `unity-slot.dashboard/1`)

## 소스에서 실행

```powershell
npm install
npm run tauri dev
```

`start.bat`(또는 `시작.bat`)은 릴리스 exe를 빌드해 `%LOCALAPPDATA%\UnitySlotWidget`에 설치하고 실행합니다. 탐색기나 직접 연 터미널에서 실행하세요.

## 라이선스

MIT. 아이콘·라이브러리는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 보세요.
