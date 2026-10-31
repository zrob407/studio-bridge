Object.defineProperty(process, 'platform', { value: 'linux' });
delete process.env.HYPRLAND_INSTANCE_SIGNATURE;
