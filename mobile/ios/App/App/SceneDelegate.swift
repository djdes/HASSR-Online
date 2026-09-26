import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Единственный путь запуска экрана: Main.storyboard в Info.plist не подключён
        // (UIMainStoryboardFile и UISceneStoryboardFile убраны), иначе UIKit поднял бы
        // второй контроллер — два WebView и двойная регистрация push при старте.
        window = UIWindow(windowScene: windowScene)
        // Свой подкласс вместо CAPBridgeViewController: в нём регистрируется WebPrint.
        window?.rootViewController = WeSetupViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
