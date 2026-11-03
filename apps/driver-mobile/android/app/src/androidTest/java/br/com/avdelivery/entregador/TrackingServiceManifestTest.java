package br.com.avdelivery.entregador;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Checks the packaged manifest on a real Android runtime. These assertions
 * guard the permission surface and the foreground-service declaration, which
 * cannot be verified by JVM tests.
 */
@RunWith(AndroidJUnit4.class)
public class TrackingServiceManifestTest {

    private Context context() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    private boolean requests(String permission) {
        try {
            PackageInfo info = context().getPackageManager().getPackageInfo(
                    context().getPackageName(),
                    PackageManager.GET_PERMISSIONS
            );
            String[] requested = info.requestedPermissions;

            if (requested == null) {
                return false;
            }

            for (String item : requested) {
                if (permission.equals(item)) {
                    return true;
                }
            }

            return false;
        } catch (PackageManager.NameNotFoundException error) {
            throw new AssertionError(error);
        }
    }

    @Test
    public void packageIdentityMatchesTheHomologationBuild() {
        assertEquals("br.com.avdelivery.entregador", context().getPackageName());
    }

    @Test
    public void requestsLocationAndForegroundServicePermissionsOnly() {
        assertTrue(requests(android.Manifest.permission.ACCESS_FINE_LOCATION));
        assertTrue(requests(android.Manifest.permission.ACCESS_COARSE_LOCATION));
        assertTrue(requests(android.Manifest.permission.FOREGROUND_SERVICE));
        assertTrue(requests(android.Manifest.permission.FOREGROUND_SERVICE_LOCATION));
        assertTrue(requests(android.Manifest.permission.POST_NOTIFICATIONS));
        assertTrue(requests(android.Manifest.permission.ACCESS_NETWORK_STATE));
        assertFalse(
                "ACCESS_BACKGROUND_LOCATION must stay out of the app",
                requests(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        );
    }

    @Test
    public void trackingServiceIsNotExportedAndDeclaresLocationType() throws Exception {
        ServiceInfo info = context().getPackageManager().getServiceInfo(
                new ComponentName(context(), TrackingService.class),
                0
        );

        assertNotNull(info);
        assertFalse(info.exported);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int locationType = info.getForegroundServiceType() & ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION, locationType);
        }
    }

    @Test
    public void applicationDoesNotAllowCredentialBackup() {
        ApplicationInfo info = context().getApplicationInfo();
        assertEquals(0, info.flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
    }
}
