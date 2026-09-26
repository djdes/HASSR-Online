import Capacitor
import UIKit

/// Экран приложения: встроенный браузер Capacitor с сайтом wesetup.ru.
/// Свой подкласс нужен, чтобы зарегистрировать локальный плагин WebPrint —
/// плагины из npm Capacitor находит сам, а плагины внутри приложения — нет.
class WeSetupViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WebPrintPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Жест «назад» от левого края, как в Safari: на iOS нет системной кнопки
        // «назад», а открытый файл или чужая страница иначе стали бы тупиком.
        webView?.allowsBackForwardNavigationGestures = true
    }
}
