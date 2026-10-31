package br.com.avdelivery.entregador;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrackingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
