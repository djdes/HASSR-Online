import Capacitor
import UIKit

/// Печать страницы и переход в настройки приложения.
///
/// Во встроенном браузере iOS window.print() не открывает окно печати, поэтому
/// сайт в приложении зовёт WebPrint.print() — системное окно AirPrint (принтер
/// или «Сохранить в Файлы» как PDF) с текущей страницей.
/// WebPrint.printFile({ path, jobName }) — то же окно для готового PDF (бланк
/// журнала): сайт кладёт файл во временную папку и передаёт его адрес. Без
/// этого «Распечатать» на iPhone открывало лист «Поделиться», и печать была
/// там лишним шагом (на Android окно печати открывается сразу).
/// WebPrint.openSettings() открывает экран приложения в «Настройках» — туда ведём,
/// если человек запретил камеру, микрофон или уведомления.
/// Регистрируется в WeSetupViewController.capacitorDidLoad().
@objc(WebPrintPlugin)
public class WebPrintPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebPrintPlugin"
    public let jsName = "WebPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printFile", returnType: CAPPluginReturnPromise),
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
            // Источник печати один: файл от прошлого printFile сбрасываем.
            controller.printingItem = nil
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

    @objc func printFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Не указан файл для печати")
            return
        }
        // Filesystem.writeFile отдаёт file://-адрес; обычный путь тоже примем.
        let parsed: URL? = path.hasPrefix("file://") ? URL(string: path) : URL(fileURLWithPath: path)
        guard let url = parsed, url.isFileURL, FileManager.default.fileExists(atPath: url.path) else {
            call.reject("Файл для печати не найден")
            return
        }
        let jobName = call.getString("jobName") ?? url.deletingPathExtension().lastPathComponent
        DispatchQueue.main.async {
            guard UIPrintInteractionController.canPrint(url) else {
                call.reject("Этот файл нельзя напечатать")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = jobName
            info.outputType = .general
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            // Источник печати один: страницу от прошлого print сбрасываем.
            controller.printFormatter = nil
            controller.printingItem = url
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
