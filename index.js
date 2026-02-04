BX24.init(async () => {
    const BX24W = new BX24Wrapper();
    const urlParams = new URLSearchParams(window.location.search);
    const domain = urlParams.get('DOMAIN');

    const getUsers = async () => {
        const users = await BX24W.callMethod("user.get", {});
        return Object.fromEntries(users.map(u => [u.LAST_NAME, u]));
    }

    /**
     * Формирует номральные гомосексуальные связи сущностей, как в старом добром SQL.
     * Сделка -> товарные позиции (услуги) -> Сами услуги непосредственно.
     * @returns {} - объект, который реализует эту структуру.
     */
    const getProductRows = async() => {
        const p = {filter: {CATEGORY_ID: 0}, select: ['ID']}
        // Получаем сделки
        const deals = await BX24W.callListMethod('crm.deal.list', p);
        const result = {};
        const productRowsCalls = [];
        // Формируем запрос на товарные позиции и готовим итоговый объект
        for ( const deal of deals ) {
            result[deal.ID] = deal;
            productRowsCalls.push(['crm.deal.productrows.get', {id: deal.ID}]);
        }
        const productRows = await BX24W.callLongBatch(productRowsCalls, false);
        // Дальше начинается магия работы с указателями. Понимайте как хотите.
        const services = {};
        const servicesCalls = [];
        for ( const index in productRows) {
            const dealId = productRowsCalls[index][1]?.id;
            const deal = result[dealId];
            deal.services = [];
            const products = productRows[index];
            for ( const product of products) {
                // Нужны только услуги
                if ( product.TYPE !== 7 ) {
                    continue;
                }
                deal.services.push(product);
                if ( !Object.hasOwn(services, product.PRODUCT_ID) ) {
                    servicesCalls.push(['catalog.product.service.get', {id: product.PRODUCT_ID}]);
                    services[product.PRODUCT_ID] = [];
                }
                services[product.PRODUCT_ID].push(product);
            }
        }
        // Получаем вариации (услуги непосредственно) и разбираем их
        const variations = await BX24W.callLongBatch(servicesCalls, false);
        for ( const line of variations ) {
            const service = line.service;
            services[service.id].forEach(p => p.parent = service);
        }
        return result;
    }

    const createTd = (data, className = "text-nowrap px-3") => {
        const td = document.createElement('td');
        if ( data instanceof HTMLElement) {
            td.appendChild(data);
        } else {
            td.textContent = data;
        }
        td.className = className;
        return td;
    }

    const getUserLinkElement = (lastName, users) => {
        const user = users[lastName];
        if (user && user.ID) {
            const link = document.createElement('a');
            link.href = `https://${domain}/company/personal/user/${user.ID}/`;
            link.target = "_blank";
            link.textContent = lastName;
            link.classList.add('text-decoration-none', 'fw-medium');
            return link;
        }
        return lastName;
    }

    const getDealLinkElement = (dealId) => {
        const link = document.createElement('a');
        link.href = `https://${domain}/crm/deal/details/${dealId}/`;
        link.target = "_blank";
        link.textContent = dealId;
        link.classList.add('text-decoration-none', 'fw-medium');
        return link;
    }

    const main = async() => {
        const [users, products] = await Promise.all([getUsers(), getProductRows()]);
        const tbody = document.getElementById('table-body');
        let result = 0;
        // console.log(users, products);
        for ( const deal of Object.values(products) ) {
            for ( const service of deal.services ) {
                const serviceName = service?.parent?.name || service.ORIGINAL_PRODUCT_NAME;
                const splited = serviceName.split(' ');
                const tr = document.createElement('tr');
                tr.appendChild(createTd(getUserLinkElement(splited.pop(), users)));
                tr.appendChild(createTd(getDealLinkElement(deal.ID)));
                tr.appendChild(createTd(splited.join(" ")));
                const qty = service.QUANTITY;
                tr.appendChild(createTd(service.QUANTITY, 'px-3'));
                const priceRub = service?.parent?.property108?.value || "0|RUB";
                const price = Number.parseFloat(priceRub);
                tr.appendChild(createTd(price));
                const sum = price * qty;
                tr.appendChild(createTd(sum.toFixed(2)));
                result += sum;
                tbody.appendChild(tr);
            }
        }
        document.getElementById('total-amount').textContent = result.toFixed(2);
        document.getElementById('loader').classList.replace('d-flex', 'd-none');
        document.getElementById('table-container').classList.remove('d-none');
    }
    await main();
});
