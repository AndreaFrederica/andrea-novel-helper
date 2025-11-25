// 模块声明，解决CommonJS/ESM兼容性问题
declare module '@faker-js/faker' {
	interface Faker {
		[key: string]: any;
	}
	const faker: Faker;
	export = faker;
}

declare module '@faker-js/faker/locale/en' {
	interface Faker {
		[key: string]: any;
	}
	const faker: Faker;
	export = faker;
}

declare module '@faker-js/faker/locale/zh_CN' {
	interface Faker {
		[key: string]: any;
	}
	const faker: Faker;
	export = faker;
}

declare module '@faker-js/faker/locale/ja' {
	interface Faker {
		[key: string]: any;
	}
	const faker: Faker;
	export = faker;
}