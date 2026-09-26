import Capacitor
import UIKit

/// Печать страницы и переход в настройки приложения.
///
/// Во встроенном браузере iOS window.print() не открывает окно печати, поэтому
/// сайт в приложении зовёт WebPrint.print() — системное окно AirPrint (принтер
/// или «Сохранить в Файлы» как PDF) с текущей страницей.
/// WebPrint.openSettings() открывает экран приложения в «Настройках» — туда ведём,
/// если человек запретил камеру, микрофон или уведомления.
/// Регистрируется в WeSetupViewController.capacitorDidLoad().
@objc(WebPrintPlugin)
public class WebPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebPrintPlugin"
    public let jsName = "WebPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    @objc func print(_ call: CAPPluginCall) {
        let jobName = call.getString("jobName") ?? "WeSetup"
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("Нет страницы для печати")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = jobName
            info.outputType = .general
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true) { _, _, error in
                if let error = error {
                    call.reject("Не удалось открыть печать", nil, error)
                } else {
                    call.resolve()
                }
            }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Не удалось открыть настройки")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("Не удалось открыть настройки")
                }
            }
        }
    }
}
