export const AppConfig = {
    appName: 'TypeScript Example Repo',
    version: '1.0.0',
    apiEndpoints: {
        users: '/api/users',
        products: '/api/products',
        orders: '/api/orders',
    },
    database: {
        host: 'localhost',
        port: 5432,
        user: 'admin',
        password: 'password',
        dbName: 'example_db',
    },
    featureFlags: {
        enableNewDashboard: true,
        enableExperimentalFeatures: false,
    }
};
