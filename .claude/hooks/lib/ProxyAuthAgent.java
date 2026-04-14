import java.lang.instrument.Instrumentation;
import java.net.Authenticator;
import java.net.PasswordAuthentication;

/** Installs a default Authenticator so Java honors http.proxyUser/http.proxyPassword
    for HTTPS CONNECT tunneling (sdkmanager uses HttpURLConnection). */
public class ProxyAuthAgent {
  public static void premain(String args, Instrumentation inst) { install(); }
  public static void agentmain(String args, Instrumentation inst) { install(); }
  private static void install() {
    final String user = System.getProperty("http.proxyUser",
                          System.getProperty("https.proxyUser", ""));
    final String pass = System.getProperty("http.proxyPassword",
                          System.getProperty("https.proxyPassword", ""));
    if (user.isEmpty()) return;
    Authenticator.setDefault(new Authenticator() {
      @Override protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication(user, pass.toCharArray());
      }
    });
  }
}
